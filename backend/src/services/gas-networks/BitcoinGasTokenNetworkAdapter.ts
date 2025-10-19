import Client from 'bitcoin-core';
import bs58 from 'bs58';
import { createECDH, createHash } from 'crypto';
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
  walletAddress?: string;
  rpcUrl?: string;
  rpcUsername?: string;
  rpcPassword?: string;
  walletName?: string;
  wif?: string;
  headers?: Record<string, string>;
}

const isLocalRpcHost = (rpcUrl?: string): boolean => {
  if (!rpcUrl) {
    return false;
  }
  try {
    const url = new URL(rpcUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
};

const readBitcoinConfig = (): BitcoinNetworkConfig => ({
  enabled: process.env.BITCOIN_ENABLED === 'true',
  networkId: process.env.BITCOIN_NETWORK_ID ?? 'bitcoin-mainnet',
  networkName: process.env.BITCOIN_NETWORK_NAME ?? 'Bitcoin Mainnet',
  nativeSymbol: process.env.BITCOIN_NATIVE_SYMBOL ?? 'BTC',
  nativeDecimals: Number(process.env.BITCOIN_NATIVE_DECIMALS ?? '8'),
  walletAddress: process.env.BITCOIN_WALLET_ADDRESS,
  rpcUrl: process.env.BITCOIN_RPC_URL,
  rpcUsername: process.env.BITCOIN_RPC_USERNAME,
  rpcPassword: process.env.BITCOIN_RPC_PASSWORD,
  headers: process.env.BITCOIN_RPC_KEY
    ? {
        Authorization: `Bearer ${process.env.BITCOIN_RPC_KEY}`
      }
    : undefined,
  walletName: process.env.BITCOIN_WALLET_NAME,
  wif: process.env.BITCOIN_WIF
});

const createClient = (config: BitcoinNetworkConfig): Client => {
  if (!config.rpcUrl /*|| !config.rpcUsername || !config.rpcPassword*/) {
    throw new Error('[Bitcoin] RPC configuration missing');
  }
  const normalizedHost = config.rpcUrl.replace(/\/+$/, '');
  const options: Record<string, unknown> = {
    host: normalizedHost
  };

  const hasBasicAuth = Boolean(config.rpcUsername && config.rpcPassword);
  if (hasBasicAuth) {
    options.username = config.rpcUsername;
    options.password = config.rpcPassword;
  }

  if (config.walletName) {
    options.wallet = config.walletName;
  }

  if (config.headers && Object.keys(config.headers).length > 0) {
    options.headers = config.headers;
  }

  const ClientConstructor = Client as unknown as new (config?: any) => Client;
  return new ClientConstructor(options);
};

const isUnsupportedWalletMethodError = (message: string): boolean =>
  /unsupported method/i.test(message) ||
  /method not found/i.test(message) ||
  /does not exist/i.test(message) ||
  /wallet.*disabled/i.test(message) ||
  /not allowed on this endpoint/i.test(message);

const doubleSha256 = (data: Uint8Array): Buffer => {
  const first = createHash('sha256').update(data).digest();
  return createHash('sha256').update(first).digest();
};

const deriveP2PKHAddressFromWif = (wif: string): string => {
  const decoded = Buffer.from(bs58.decode(wif));
  if (decoded.length < 4) {
    throw new Error('Invalid WIF: too short');
  }

  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expectedChecksum = doubleSha256(payload).subarray(0, 4);
  if (!checksum.equals(expectedChecksum)) {
    throw new Error('Invalid WIF: checksum mismatch');
  }

  const version = payload[0];
  const hasCompressionFlag = payload.length === 34 && payload[payload.length - 1] === 0x01;
  const privateKey = hasCompressionFlag ? payload.subarray(1, payload.length - 1) : payload.subarray(1);
  if (privateKey.length !== 32) {
    throw new Error('Invalid WIF: unexpected payload length');
  }

  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(privateKey);
  const publicKey = ecdh.getPublicKey(
    undefined,
    hasCompressionFlag ? 'compressed' : 'uncompressed'
  );

  const sha256 = createHash('sha256').update(publicKey).digest();
  const publicKeyHash = createHash('ripemd160').update(sha256).digest();

  // Determine address prefix from WIF version byte (0x80 => mainnet, 0xef => test networks)
  const addressVersion = version === 0xef ? 0x6f : 0x00;
  const addressPayload = Buffer.concat([Buffer.from([addressVersion]), publicKeyHash]);
  const addressChecksum = doubleSha256(addressPayload).subarray(0, 4);

  return bs58.encode(Buffer.concat([addressPayload, addressChecksum]));
};

export class BitcoinGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'BITCOIN';
  private client?: Client;
  private privateKeyImported = false;
  private privateKeyImportAttempted = false;
  private walletRpcUnavailable = false;
  private resolvedWalletAddress?: string;
  private fallbackBalanceNoticeShown = false;
  private fallbackAddressMissingWarned = false;

  private async getClient(): Promise<Client> {
    const config = readBitcoinConfig();
    if (!this.client) {
      this.client = createClient(config);
    }
    if (!this.privateKeyImported && !this.privateKeyImportAttempted) {
      await this.ensureWalletKey(this.client, config);
    }
    return this.client;
  }

  private async ensureWalletKey(client: Client, config: BitcoinNetworkConfig): Promise<void> {
    if (!config.wif || this.privateKeyImported === true || this.privateKeyImportAttempted === true) {
      return;
    }

    if (!isLocalRpcHost(config.rpcUrl)) {
      this.privateKeyImportAttempted = true;
      console.log(
        'ℹ️  [Bitcoin] Skipping private key import; remote RPC providers typically disable wallet commands. Ensure the destination wallet already contains the key.'
      );
      return;
    }

    this.privateKeyImportAttempted = true;
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
      if (/unsupported method/i.test(message)) {
        console.warn(
          'ℹ️  [Bitcoin] The connected RPC node does not expose wallet import functionality; please import the key manually if required.'
        );
      }
      const nonRetryablePatterns = [/specified chain/i, /method not found/i, /wallet/i, /unsupported method/i];
      const shouldRetry =
        !/auth/i.test(message) &&
        !nonRetryablePatterns.some(pattern => pattern.test(message));
      if (shouldRetry) {
        this.privateKeyImportAttempted = false;
      } else {
        console.warn('ℹ️  [Bitcoin] Skipping further automatic private key import attempts.');
      }
    }
  }

  private ensureStaticWalletAddress(config: BitcoinNetworkConfig): string | undefined {
    if (this.resolvedWalletAddress) {
      return this.resolvedWalletAddress;
    }

    if (config.walletAddress) {
      this.resolvedWalletAddress = config.walletAddress;
      return config.walletAddress;
    }

    if (config.wif) {
      try {
        const derivedAddress = deriveP2PKHAddressFromWif(config.wif);
        this.resolvedWalletAddress = derivedAddress;
        return derivedAddress;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  [Bitcoin] Failed to derive address from WIF: ${message}`);
      }
    }

    return undefined;
  }

  private async resolveWalletAddress(
    config: BitcoinNetworkConfig,
    client: Client
  ): Promise<string | undefined> {
    const staticAddress = this.ensureStaticWalletAddress(config);
    if (staticAddress) {
      return staticAddress;
    }

    if (this.walletRpcUnavailable) {
      return undefined;
    }

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
            this.resolvedWalletAddress = candidates[0];
            return this.resolvedWalletAddress;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Label not found')) {
          continue;
        }
        console.warn(`⚠️  [Bitcoin] Failed to read address for label "${label}": ${message}`);
        if (isUnsupportedWalletMethodError(message)) {
          this.walletRpcUnavailable = true;
          console.warn(
            'ℹ️  [Bitcoin] Wallet RPC commands are not available on the configured endpoint; set BITCOIN_WALLET_ADDRESS to supply a static address.'
          );
          return this.resolvedWalletAddress;
        }
      }
    }

    try {
      const defaultAddress = await client.command('getrawchangeaddress');
      if (typeof defaultAddress === 'string' && defaultAddress.length > 0) {
        this.resolvedWalletAddress = defaultAddress;
        return this.resolvedWalletAddress;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Bitcoin] Failed to resolve change address: ${message}`);
      if (isUnsupportedWalletMethodError(message)) {
        this.walletRpcUnavailable = true;
        console.warn(
          'ℹ️  [Bitcoin] Wallet RPC commands are not available on the configured endpoint; set BITCOIN_WALLET_ADDRESS to supply a static address.'
        );
      }
    }

    return undefined;
  }

  private async tryWalletlessBalanceLookup(
    client: Client,
    config: BitcoinNetworkConfig
  ): Promise<number | undefined> {
    const address = this.ensureStaticWalletAddress(config);
    if (!address) {
      if (!this.fallbackAddressMissingWarned) {
        console.warn(
          'ℹ️  [Bitcoin] Unable to determine wallet address; set BITCOIN_WALLET_ADDRESS (or BITCOIN_WIF locally) to enable balance queries without wallet RPC support.'
        );
        this.fallbackAddressMissingWarned = true;
      }
      return undefined;
    }

    if (!this.fallbackBalanceNoticeShown) {
      console.log(
        'ℹ️  [Bitcoin] Wallet RPC is unavailable; falling back to `scantxoutset` balance queries for address-based monitoring.'
      );
      this.fallbackBalanceNoticeShown = true;
    }

    try {
      const response = await client.command('scantxoutset', 'start', [`addr(${address})`]);
      const totalAmount =
        typeof response?.total_amount === 'number'
          ? response.total_amount
          : Number(response?.total_amount ?? NaN);
      return Number.isFinite(totalAmount) ? totalAmount : undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [Bitcoin] UTXO scan balance fallback failed: ${message}`);
      return undefined;
    }
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readBitcoinConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.rpcUrl/* || !config.rpcUsername || !config.rpcPassword*/) {
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
    const config = readBitcoinConfig();
    const client = await this.getClient();

    const resolveFallback = async (): Promise<number> => {
      const fallbackBalance = await this.tryWalletlessBalanceLookup(client, config);
      return fallbackBalance ?? 0;
    };

    if (this.walletRpcUnavailable) {
      return resolveFallback();
    }

    try {
      const balance = NaN; // FIXME: await client.command('getbalance') doesn't work on Alchemy.
      return typeof balance === 'string' ? Number(balance) : balance ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isUnsupportedWalletMethodError(message)) {
        const fallbackValue = await resolveFallback();
        this.walletRpcUnavailable = true;
        console.warn(
          `⚠️  [Bitcoin] Failed to read wallet balance via wallet RPC: ${message}. ${
            fallbackValue > 0
              ? 'Returning value from UTXO scan fallback.'
              : 'Returning 0; provide a wallet address to enable UTXO scan fallback.'
          }`
        );
        return fallbackValue;
      }
      throw error;
    }
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
    if (this.walletRpcUnavailable) {
      throw new Error(
        '[Bitcoin] Wallet RPC commands are not available on the configured endpoint; unable to send transfers.'
      );
    }
    const client = await this.getClient();
    const txId = await client.command('sendtoaddress', recipientAddress, amountToken);
    return { transactionHash: txId };
  }
}

export const bitcoinGasTokenNetworkAdapter = new BitcoinGasTokenNetworkAdapter();
