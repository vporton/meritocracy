import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';
import StellarSdk from 'stellar-sdk';

const { Asset, Keypair, Networks, Operation, Server, StrKey, TransactionBuilder } = StellarSdk;

type HorizonServer = InstanceType<typeof Server>;
type HorizonKeypair = InstanceType<typeof Keypair>;

interface StellarNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  horizonUrl?: string;
  walletAddress?: string;
  secretKey?: string;
  networkPassphrase: string;
  baseFeeStroops: number;
}

const readStellarConfig = (): StellarNetworkConfig => {
  const rawBaseFee = Number(process.env.STELLAR_BASE_FEE_STROOPS ?? '100');
  const baseFeeStroops =
    Number.isFinite(rawBaseFee) && rawBaseFee > 0 ? Math.floor(rawBaseFee) : 100;

  return {
  enabled: process.env.STELLAR_ENABLED === 'true',
  networkId: process.env.STELLAR_NETWORK_ID ?? 'stellar-public',
  networkName: process.env.STELLAR_NETWORK_NAME ?? 'Stellar Public Network',
  nativeSymbol: process.env.STELLAR_NATIVE_SYMBOL ?? 'XLM',
  nativeDecimals: Number(process.env.STELLAR_NATIVE_DECIMALS ?? '7'),
  horizonUrl: process.env.STELLAR_HORIZON_URL,
  walletAddress: process.env.STELLAR_WALLET_ADDRESS,
  secretKey: process.env.STELLAR_SECRET_KEY,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.PUBLIC,
    baseFeeStroops
  };
};

const stroopsToToken = (stroops: number, decimals: number): number => stroops / 10 ** decimals;

const toPaymentAmount = (amountToken: number, decimals: number): string => {
  const multiplier = 10 ** decimals;
  const stroops = Math.round(amountToken * multiplier);
  if (stroops <= 0) {
    throw new Error('[Stellar] Transfer amount must be greater than zero');
  }
  const normalized = (stroops / multiplier).toFixed(decimals);
  return normalized.replace(/\.?0+$/, '') || '0';
};

export class StellarGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'STELLAR';
  private server?: HorizonServer;
  private signer?: HorizonKeypair;

  private getServer(config: StellarNetworkConfig): HorizonServer {
    if (!this.server) {
      const allowHttp = config.horizonUrl?.startsWith('http://') ?? false;
      this.server = new Server(config.horizonUrl!, { allowHttp });
    }
    return this.server;
  }

  private getSigner(config: StellarNetworkConfig): HorizonKeypair {
    if (!this.signer) {
      this.signer = Keypair.fromSecret(config.secretKey!);
    }
    return this.signer;
  }

  private resolveWalletAddress(config: StellarNetworkConfig): string | undefined {
    if (config.walletAddress && StrKey.isValidEd25519PublicKey(config.walletAddress)) {
      return config.walletAddress;
    }

    try {
      return this.getSigner(config).publicKey();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Stellar] Failed to derive wallet address: ${message}`);
      return config.walletAddress;
    }
  }

  private ensureEnabledConfig(): StellarNetworkConfig {
    const config = readStellarConfig();
    if (!config.enabled) {
      throw new Error('[Stellar] Network disabled');
    }
    if (!config.horizonUrl) {
      throw new Error('[Stellar] STELLAR_HORIZON_URL not configured');
    }
    if (!config.secretKey) {
      throw new Error('[Stellar] STELLAR_SECRET_KEY not configured');
    }
    return config;
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readStellarConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.horizonUrl || !config.secretKey) {
      console.warn('⚠️  [Stellar] Missing Horizon URL or secret key configuration, skipping.');
      return [];
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [Stellar] Token type ${tokenOptions.tokenType} not supported, skipping.`);
      return [];
    }

    const walletAddress = this.resolveWalletAddress(config);
    if (!walletAddress) {
      console.warn('⚠️  [Stellar] Unable to determine wallet address, skipping.');
      return [];
    }

    return [
      {
        adapterType: this.type,
        networkId: config.networkId,
        networkName: config.networkName,
        tokenType: 'NATIVE',
        tokenSymbol: config.nativeSymbol,
        tokenDecimals: config.nativeDecimals,
        nativeTokenSymbol: config.nativeSymbol,
        nativeTokenDecimals: config.nativeDecimals,
        walletAddress,
        defaultGasCostToken: stroopsToToken(config.baseFeeStroops, config.nativeDecimals)
      }
    ];
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const config = this.ensureEnabledConfig();
    const server = this.getServer(config);
    const signerPublicKey = this.getSigner(config).publicKey();

    try {
      const account = await server.loadAccount(signerPublicKey);
      const nativeBalance = account.balances.find(balance => balance.asset_type === 'native');
      if (!nativeBalance) {
        return 0;
      }
      return parseFloat(nativeBalance.balance);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[Stellar] Failed to fetch balance: ${message}`);
    }
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { stellarAddress?: string | null }).stellarAddress ?? null;
  }

  private async resolveBaseFee(server: HorizonServer, config: StellarNetworkConfig): Promise<number> {
    try {
      const fee = await server.fetchBaseFee();
      if (typeof fee === 'number' && fee > 0) {
        return fee;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Stellar] Falling back to configured base fee: ${message}`);
    }
    return config.baseFeeStroops;
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      if (!StrKey.isValidEd25519PublicKey(recipientAddress)) {
        return { deferReason: 'Invalid Stellar recipient address' };
      }

      const config = this.ensureEnabledConfig();
      const server = this.getServer(config);
      const baseFee = await this.resolveBaseFee(server, config);
      const gasCostToken = stroopsToToken(baseFee, context.nativeTokenDecimals);

      if (amountToken <= gasCostToken) {
        return {
          gasCostToken,
          deferReason: `Transfer amount ${amountToken} ${context.tokenSymbol} must exceed fee ${gasCostToken} ${context.tokenSymbol}`
        };
      }

      return { gasCostToken };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to estimate Stellar fee';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureEnabledConfig();
    const server = this.getServer(config);
    const signer = this.getSigner(config);
    const sourceAccount = await server.loadAccount(signer.publicKey());
    const baseFee = await this.resolveBaseFee(server, config);

    const amount = toPaymentAmount(amountToken, context.tokenDecimals);
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: baseFee.toString(),
      networkPassphrase: config.networkPassphrase
    })
      .addOperation(
        Operation.payment({
          destination: recipientAddress,
          asset: Asset.native(),
          amount
        })
      )
      .setTimeout(180)
      .build();

    transaction.sign(signer);

    try {
      const result = await server.submitTransaction(transaction);
      return {
        transactionHash: result.hash,
        metadata: {
          ledger: result.ledger,
          result_xdr: result.result_xdr
        }
      };
    } catch (error) {
      const message =
        error instanceof Error && 'response' in error
          ? JSON.stringify((error as any).response?.data ?? {}, null, 2)
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(`[Stellar] Transaction failed: ${message}`);
    }
  }
}

export const stellarGasTokenNetworkAdapter = new StellarGasTokenNetworkAdapter();
