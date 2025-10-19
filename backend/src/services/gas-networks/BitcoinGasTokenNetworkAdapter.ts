import Client from 'bitcoin-core';
import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

interface BitcoinNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl?: string;
  rpcUsername?: string;
  rpcPassword?: string;
  walletName?: string;
}

const readBitcoinConfig = (): BitcoinNetworkConfig => ({
  enabled: process.env.BITCOIN_ENABLED === 'true',
  networkId: process.env.BITCOIN_NETWORK_ID ?? 'bitcoin-mainnet',
  networkName: process.env.BITCOIN_NETWORK_NAME ?? 'Bitcoin Mainnet',
  nativeSymbol: process.env.BITCOIN_NATIVE_SYMBOL ?? 'BTC',
  nativeDecimals: Number(process.env.BITCOIN_NATIVE_DECIMALS ?? '8'),
  rpcUrl: process.env.BITCOIN_RPC_URL,
  rpcUsername: process.env.BITCOIN_RPC_USERNAME,
  rpcPassword: process.env.BITCOIN_RPC_PASSWORD,
  walletName: process.env.BITCOIN_WALLET_NAME
});

const createClient = (config: BitcoinNetworkConfig): Client => {
  if (!config.rpcUrl || !config.rpcUsername || !config.rpcPassword) {
    throw new Error('[Bitcoin] RPC configuration missing');
  }
  const url = new URL(config.rpcUrl);
  const options: any = {
    host: url.hostname,
    username: config.rpcUsername,
    password: config.rpcPassword,
    wallet: config.walletName
  };
  if (url.port) {
    options.port = Number(url.port);
  }
  if (url.protocol === 'https:') {
    options.ssl = { enabled: true };
  }
  const ClientConstructor = Client as unknown as new (config?: any) => Client;
  return new ClientConstructor(options);
};

export class BitcoinGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'BITCOIN';
  private client?: Client;

  private ensureClient(): Client {
    if (!this.client) {
      const config = readBitcoinConfig();
      this.client = createClient(config);
    }
    return this.client;
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readBitcoinConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.rpcUrl || !config.rpcUsername || !config.rpcPassword) {
      console.warn('⚠️  [Bitcoin] Missing RPC configuration, skipping.');
      return [];
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [Bitcoin] Token type ${tokenOptions.tokenType} not supported, skipping.`);
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

  async getWalletBalance(_context: GasTokenNetworkContext): Promise<number> {
    const client = this.ensureClient();
    const balance = await client.command('getbalance');
    return typeof balance === 'string' ? Number(balance) : balance ?? 0;
  }

  async getDynamicGasReserve(_context: GasTokenNetworkContext): Promise<number> {
    return Number(process.env.BITCOIN_MIN_GAS_RESERVE ?? '0.0001');
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { bitcoinAddress?: string | null }).bitcoinAddress ?? null;
  }

  async estimateTransfer(
    _context: GasTokenNetworkContext,
    _recipientAddress: string,
    _amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const client = this.ensureClient();
      const estimate = await client.command('estimatesmartfee', 6);
      const feerate = typeof estimate?.feerate === 'number' ? estimate.feerate : Number(estimate?.feerate ?? 0);
      return feerate > 0 ? { gasCostToken: feerate } : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Bitcoin estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    _context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    if (amountToken <= 0) {
      throw new Error('[Bitcoin] Transfer amount must be greater than zero');
    }
    const client = this.ensureClient();
    const txId = await client.command('sendtoaddress', recipientAddress, amountToken);
    return { transactionHash: txId };
  }
}

export const bitcoinGasTokenNetworkAdapter = new BitcoinGasTokenNetworkAdapter();
