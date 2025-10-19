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
  wif?: string;
  headers?: Record<string, string>;
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
  // headers: {
  //   "Authorization": "Bearer " + process.env.BITCOIN_RPC_KEY,
  // },
  walletName: process.env.BITCOIN_WALLET_NAME,
  wif: process.env.BITCOIN_WIF
});

const createClient = (config: BitcoinNetworkConfig): Client => {
  if (!config.rpcUrl || !config.rpcUsername || !config.rpcPassword) {
    throw new Error('[Bitcoin] RPC configuration missing');
  }
  const url = new URL(config.rpcUrl);
  const options: any = {
    host: url.protocol + "//" + url.hostname + ":" + url.port,
    username: config.rpcUsername,
    password: config.rpcPassword,
    wallet: config.walletName,
    headers: config.headers,
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
  private privateKeyImported = false;

  private async getClient(): Promise<Client> {
    const config = readBitcoinConfig();
    if (!this.client) {
      this.client = createClient(config);
    }
    if (!this.privateKeyImported) {
      await this.ensureWalletKey(this.client, config);
    }
    return this.client;
  }

  private async ensureWalletKey(client: Client, config: BitcoinNetworkConfig): Promise<void> {
    if (!config.wif || this.privateKeyImported === true) {
      return;
    }
    try {
      await client.command('importprivkey', config.wif, config.walletName ?? 'gas-distribution', false);
      this.privateKeyImported = true;
      console.log('🔑 [Bitcoin] Private key imported into wallet.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('already there') || message.includes('exists')) {
        this.privateKeyImported = true;
        console.log('ℹ️  [Bitcoin] Private key already present in wallet.');
        return;
      }
      console.warn(`⚠️  [Bitcoin] Failed to import private key: ${message}`);
    }
  }

  private async resolveWalletAddress(
    config: BitcoinNetworkConfig,
    client: Client
  ): Promise<string | undefined> {
    const labelsToCheck = new Set<string>();
    if (config.walletName) {
      labelsToCheck.add(config.walletName);
    }
    labelsToCheck.add('gas-distribution');

    for (const label of labelsToCheck) {
      try {
        const addresses = await client.command('getaddressesbylabel', label);
        if (addresses && typeof addresses === 'object') {
          const candidates = Object.keys(addresses);
          if (candidates.length > 0) {
            return candidates[0];
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Label not found')) {
          continue;
        }
        console.warn(`⚠️  [Bitcoin] Failed to read address for label "${label}": ${message}`);
      }
    }

    try {
      const defaultAddress = await client.command('getrawchangeaddress');
      if (typeof defaultAddress === 'string' && defaultAddress.length > 0) {
        return defaultAddress;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Bitcoin] Failed to resolve change address: ${message}`);
    }

    return undefined;
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

    let walletAddress: string | undefined;
    try {
      const client = await this.getClient();
      walletAddress = await this.resolveWalletAddress(config, client);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Bitcoin] Failed to resolve wallet address: ${message}`);
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
        walletAddress
      }
    ];
  }

  async getWalletBalance(_context: GasTokenNetworkContext): Promise<number> {
    const client = await this.getClient();
    const balance = await client.command('getbalance');
    return typeof balance === 'string' ? Number(balance) : balance ?? 0;
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
      const client = await this.getClient();
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
    const client = await this.getClient();
    const txId = await client.command('sendtoaddress', recipientAddress, amountToken);
    return { transactionHash: txId };
  }
}

export const bitcoinGasTokenNetworkAdapter = new BitcoinGasTokenNetworkAdapter();
