import { ApiPromise, WsProvider, HttpProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

interface PolkadotNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl?: string;
  walletAddress?: string;
  secretUri?: string;
}

const readPolkadotConfig = (): PolkadotNetworkConfig => ({
  enabled: process.env.POLKADOT_ENABLED === 'true',
  networkId: process.env.POLKADOT_NETWORK_ID ?? 'polkadot-mainnet',
  networkName: process.env.POLKADOT_NETWORK_NAME ?? 'Polkadot Mainnet',
  nativeSymbol: process.env.POLKADOT_NATIVE_SYMBOL ?? 'DOT',
  nativeDecimals: Number(process.env.POLKADOT_NATIVE_DECIMALS ?? '10'),
  rpcUrl: process.env.POLKADOT_RPC_URL,
  walletAddress: process.env.POLKADOT_WALLET_ADDRESS,
  secretUri: process.env.POLKADOT_SECRET_URI
});

const convertPlanckToUnits = (value: bigint, decimals: number): number => {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionString = fraction === 0n ? '' : fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  const numericString = fractionString ? `${whole.toString()}.${fractionString}` : whole.toString();
  return Number(numericString);
};

export class PolkadotGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'POLKADOT';
  private apiPromise?: Promise<ApiPromise>;
  private signer?: ReturnType<Keyring['addFromUri']>;

  private ensureConfigEnabled(): PolkadotNetworkConfig {
    const config = readPolkadotConfig();
    if (!config.enabled) {
      throw new Error('[Polkadot] Network disabled');
    }
    if (!config.rpcUrl) {
      throw new Error('[Polkadot] POLKADOT_RPC_URL not configured');
    }
    if (!config.secretUri && !config.walletAddress) {
      throw new Error('[Polkadot] Missing signing secret or wallet address');
    }
    return config;
  }

  private async getApi(config: PolkadotNetworkConfig): Promise<ApiPromise> {
    if (!this.apiPromise) {
      const provider = config.rpcUrl!.startsWith('ws')
        ? new WsProvider(config.rpcUrl)
        : new HttpProvider(config.rpcUrl!);
      this.apiPromise = ApiPromise.create({ provider });
    }
    return this.apiPromise;
  }

  private async getSigner(config: PolkadotNetworkConfig) {
    if (this.signer) {
      return this.signer;
    }
    if (!config.secretUri) {
      throw new Error('[Polkadot] POLKADOT_SECRET_URI is required to sign transactions');
    }
    await cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519' });
    this.signer = keyring.addFromMnemonic(config.secretUri); // keyring.addFromUri(config.secretUri); // TODO@P3: Support both.
    return this.signer;
  }

  private async getSignerAddress(config: PolkadotNetworkConfig): Promise<string> {
    if (config.walletAddress) {
      return config.walletAddress;
    }
    const signer = await this.getSigner(config);
    return signer.address;
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readPolkadotConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.rpcUrl || (!config.walletAddress && !config.secretUri)) {
      console.warn('⚠️  [Polkadot] Missing RPC URL or signing configuration, skipping.');
      return [];
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [Polkadot] Token type ${tokenOptions.tokenType} not supported, skipping.`);
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
        nativeTokenDecimals: config.nativeDecimals
      }
    ];
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const config = this.ensureConfigEnabled();
    const api = await this.getApi(config);
    const address = await this.getSignerAddress(config);
    const accountInfo = (await api.query.system.account(address)) as unknown as {
      data: { free: { toBigInt(): bigint } };
    };
    const free = accountInfo.data.free.toBigInt();
    return convertPlanckToUnits(free, context.tokenDecimals);
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { polkadotAddress?: string | null }).polkadotAddress ?? null;
  }

  private toPlanck(amountToken: number, decimals: number): bigint {
    const factor = 10 ** decimals;
    return BigInt(Math.round(amountToken * factor));
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const config = this.ensureConfigEnabled();
      const api = await this.getApi(config);
      const signer = await this.getSigner(config);
      const amountPlanck = this.toPlanck(amountToken, context.tokenDecimals);
      if (amountPlanck <= 0n) {
        return { deferReason: 'Transfer amount too small' };
      }
      const tx = api.tx.balances.transferKeepAlive(recipientAddress, amountPlanck);
      const info = await tx.paymentInfo(signer);
      const fee = info.partialFee.toBigInt();
      return {
        gasCostToken: convertPlanckToUnits(fee, context.tokenDecimals)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Polkadot estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureConfigEnabled();
    const api = await this.getApi(config);
    const signer = await this.getSigner(config);
    const amountPlanck = this.toPlanck(amountToken, context.tokenDecimals);
    if (amountPlanck <= 0n) {
      throw new Error('[Polkadot] Transfer amount must be greater than zero');
    }
    const tx = api.tx.balances.transferKeepAlive(recipientAddress, amountPlanck);

    return new Promise<GasTransferResult>((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      tx.signAndSend(signer, result => {
        if (result.dispatchError) {
          if (unsubscribe) {
            unsubscribe();
          }
          if (result.dispatchError.isModule) {
            const meta = api.registry.findMetaError(result.dispatchError.asModule);
            reject(new Error(`[Polkadot] ${meta.section}.${meta.name}: ${meta.docs.join(' ')}`));
          } else {
            reject(new Error(`[Polkadot] ${result.dispatchError.toString()}`));
          }
          return;
        }
        if (result.status.isInBlock || result.status.isFinalized) {
          if (unsubscribe) {
            unsubscribe();
          }
          resolve({ transactionHash: result.txHash.toHex() });
        }
      })
        .then(unsub => {
          unsubscribe = unsub;
        })
        .catch(error => reject(error));
    });
  }
}

export const polkadotGasTokenNetworkAdapter = new PolkadotGasTokenNetworkAdapter();
