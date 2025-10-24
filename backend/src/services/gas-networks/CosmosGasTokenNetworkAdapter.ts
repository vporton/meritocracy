import type { User } from '@prisma/client';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { EncodeObject } from '@cosmjs/proto-signing';
import {
  SigningStargateClient,
  GasPrice,
  coins,
  calculateFee
} from '@cosmjs/stargate';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

interface CosmosNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  denom: string;
  rpcUrl?: string;
  mnemonic?: string;
  walletAddress?: string;
  accountPrefix: string;
  gasPriceAmount: string;
  gasPriceDenom: string;
  gasAdjustment: number;
  defaultGasUnits: number;
}

const readCosmosConfig = (): CosmosNetworkConfig => ({
  enabled: process.env.COSMOS_ENABLED === 'true',
  networkId: process.env.COSMOS_NETWORK_ID ?? 'cosmoshub-mainnet',
  networkName: process.env.COSMOS_NETWORK_NAME ?? 'Cosmos Hub',
  nativeSymbol: process.env.COSMOS_NATIVE_SYMBOL ?? 'ATOM',
  nativeDecimals: Number(process.env.COSMOS_NATIVE_DECIMALS ?? '6'),
  denom: process.env.COSMOS_NATIVE_DENOM ?? 'uatom',
  rpcUrl: process.env.COSMOS_RPC_URL,
  mnemonic: process.env.COSMOS_MNEMONIC,
  walletAddress: process.env.COSMOS_WALLET_ADDRESS,
  accountPrefix: process.env.COSMOS_ACCOUNT_PREFIX ?? 'cosmos',
  gasPriceAmount: process.env.COSMOS_GAS_PRICE_AMOUNT ?? '0.025',
  gasPriceDenom: process.env.COSMOS_GAS_PRICE_DENOM ?? 'uatom',
  gasAdjustment: Number(process.env.COSMOS_GAS_ADJUSTMENT ?? '1.2'),
  defaultGasUnits: Number(process.env.COSMOS_DEFAULT_GAS_UNITS ?? '120000')
});

export class CosmosGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'COSMOS';
  private walletPromise?: Promise<DirectSecp256k1HdWallet>;
  private clientPromise?: Promise<SigningStargateClient>;
  private contextLogged = false;

  private ensureEnabledConfig(): CosmosNetworkConfig {
    const config = readCosmosConfig();
    if (!config.enabled) {
      throw new Error('[Cosmos] Network disabled');
    }
    if (!config.rpcUrl) {
      throw new Error('[Cosmos] COSMOS_RPC_URL not configured');
    }
    if (!config.mnemonic) {
      throw new Error(
        '[Cosmos] COSMOS_MNEMONIC not configured. Provide a signing mnemonic to enable ATOM distributions.'
      );
    }
    return config;
  }

  private async getWallet(config: CosmosNetworkConfig): Promise<DirectSecp256k1HdWallet> {
    if (!this.walletPromise) {
      if (!config.mnemonic) {
        throw new Error('[Cosmos] COSMOS_MNEMONIC is required to sign transactions');
      }
      this.walletPromise = DirectSecp256k1HdWallet.fromMnemonic(config.mnemonic, {
        prefix: config.accountPrefix
      });
    }
    return this.walletPromise;
  }

  private async getSignerAddress(config: CosmosNetworkConfig): Promise<string> {
    if (config.walletAddress) {
      return config.walletAddress;
    }
    const wallet = await this.getWallet(config);
    const [account] = await wallet.getAccounts();
    return account.address;
  }

  private async resolveWalletAddress(config: CosmosNetworkConfig): Promise<string | undefined> {
    try {
      return await this.getSignerAddress(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Cosmos] Failed to resolve wallet address: ${message}`);
      return config.walletAddress;
    }
  }

  private async getClient(config: CosmosNetworkConfig): Promise<SigningStargateClient> {
    if (!this.clientPromise) {
      const wallet = await this.getWallet(config);
      const gasPrice = this.getGasPrice(config);
      this.clientPromise = SigningStargateClient.connectWithSigner(config.rpcUrl!, wallet, {
        gasPrice
      });
    }
    return this.clientPromise;
  }

  private getGasPrice(config: CosmosNetworkConfig): GasPrice {
    return GasPrice.fromString(`${config.gasPriceAmount}${config.gasPriceDenom}`);
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readCosmosConfig();
    if (!config.enabled) {
      return [];
    }
    if (!config.rpcUrl) {
      console.warn('⚠️  [Cosmos] Missing RPC URL, skipping.');
      return [];
    }
    if (!config.mnemonic && !config.walletAddress) {
      console.warn(
        '⚠️  [Cosmos] ATOM wallet is missing! Set COSMOS_MNEMONIC (signing) or COSMOS_WALLET_ADDRESS to enable Cosmos Hub support.'
      );
    }
    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [Cosmos] Token type ${tokenOptions.tokenType} not supported, skipping.`);
      return [];
    }

    const walletAddress = await this.resolveWalletAddress(config);
    if (!this.contextLogged) {
      const statusEmoji = walletAddress ? '✅' : '⚠️';
      console.log(
        `${statusEmoji} [Cosmos] Initialized Cosmos Hub network context${walletAddress ? ` (wallet: ${walletAddress})` : ' (no wallet address resolved)'}.`
      );
      this.contextLogged = true;
    }

    const gasPriceAmount = Number(config.gasPriceAmount);
    const defaultGasCostToken =
      Number.isFinite(gasPriceAmount) && gasPriceAmount > 0 && config.defaultGasUnits > 0
        ? (gasPriceAmount * config.defaultGasUnits) / 10 ** config.nativeDecimals
        : undefined;

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
        defaultGasCostToken
      }
    ];
  }

  private baseUnitsToToken(amount: string | undefined, decimals: number): number {
    if (!amount) {
      return 0;
    }
    return Number(amount) / 10 ** decimals;
  }

  private toBaseUnits(amountToken: number, decimals: number): bigint {
    const factor = 10 ** decimals;
    const baseAmount = Math.round(amountToken * factor);
    return BigInt(baseAmount);
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const config = this.ensureEnabledConfig();
    const client = await this.getClient(config);
    const address = await this.getSignerAddress(config);
    const balance = await client.getBalance(address, config.denom);
    return this.baseUnitsToToken(balance.amount, context.tokenDecimals);
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { cosmosAddress?: string | null }).cosmosAddress ?? null;
  }

  private buildSendMessage(
    config: CosmosNetworkConfig,
    fromAddress: string,
    toAddress: string,
    amount: bigint
  ): EncodeObject {
    return {
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress,
        toAddress,
        amount: [
          {
            denom: config.denom,
            amount: amount.toString()
          }
        ]
      }
    };
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const config = this.ensureEnabledConfig();
      const client = await this.getClient(config);
      const fromAddress = await this.getSignerAddress(config);
      const amount = this.toBaseUnits(amountToken, context.tokenDecimals);
      if (amount <= 0n) {
        return { deferReason: 'Transfer amount too small' };
      }
      const message = this.buildSendMessage(config, fromAddress, recipientAddress, amount);
      const gasEstimation = await client.simulate(fromAddress, [message], undefined);
      const gasPrice = this.getGasPrice(config);
      const adjustedGas = Math.ceil(gasEstimation * config.gasAdjustment);
      const fee = calculateFee(adjustedGas, gasPrice);
      const feeAmount = fee.amount?.[0]?.amount ?? '0';

      return {
        gasCostToken: this.baseUnitsToToken(feeAmount, context.tokenDecimals)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Cosmos estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureEnabledConfig();
    const client = await this.getClient(config);
    const fromAddress = await this.getSignerAddress(config);
    const amount = this.toBaseUnits(amountToken, context.tokenDecimals);

    if (amount <= 0n) {
      throw new Error('[Cosmos] Transfer amount must be greater than zero');
    }

    const gasPrice = this.getGasPrice(config);
    const message = this.buildSendMessage(config, fromAddress, recipientAddress, amount);
    const gasEstimation = await client.simulate(fromAddress, [message], undefined);
    const adjustedGas = Math.ceil(gasEstimation * config.gasAdjustment);
    const fee = calculateFee(adjustedGas, gasPrice);

    const result = await client.sendTokens(
      fromAddress,
      recipientAddress,
      coins(amount.toString(), config.denom),
      fee
    );

    if (result.code !== 0) {
      throw new Error(`[Cosmos] Broadcast failed: ${result.rawLog ?? 'Unknown error'}`);
    }

    return { transactionHash: result.transactionHash };
  }
}

export const cosmosGasTokenNetworkAdapter = new CosmosGasTokenNetworkAdapter();
