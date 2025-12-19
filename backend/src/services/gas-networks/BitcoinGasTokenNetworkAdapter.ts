import Client from 'bitcoin-core';
import bs58 from 'bs58';
import { createECDH, createHash } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as tinysecp from 'tiny-secp256k1';
import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

const ECPair = ECPairFactory(tinysecp);

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
  wif?: string;
  headers?: Record<string, string>;
}

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

  if (config.headers && Object.keys(config.headers).length > 0) {
    options.headers = config.headers;
  }

  const ClientConstructor = Client as unknown as new (config?: any) => Client;
  return new ClientConstructor(options);
};

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
  private resolvedWalletAddress?: string;
  private fallbackBalanceNoticeShown = false;
  private fallbackAddressMissingWarned = false;

  private async getClient(): Promise<Client> {
    const config = readBitcoinConfig();
    if (!this.client) {
      this.client = createClient(config);
    }
    return this.client;
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
    _client: Client
  ): Promise<string | undefined> {
    return this.ensureStaticWalletAddress(config);
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

    const balance = await this.tryWalletlessBalanceLookup(client, config);
    return balance ?? 0;
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

    const config = readBitcoinConfig();
    if (!config.wif) {
      throw new Error('[Bitcoin] BITCOIN_WIF is required for walletless transfers');
    }

    const client = await this.getClient();
    const senderAddress = this.ensureStaticWalletAddress(config);
    if (!senderAddress) {
      throw new Error('[Bitcoin] Unable to determine sender address');
    }

    // 1. Get UTXOs using scantxoutset (non-wallet command)
    let unspents: any[] = [];
    try {
      const scanResult = await client.command('scantxoutset', 'start', [`addr(${senderAddress})`]);
      unspents = scanResult?.unspents ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[Bitcoin] Failed to scan UTXOs: ${message}. Ensure scantxoutset is supported by the RPC node.`);
    }

    if (unspents.length === 0) {
      throw new Error(`[Bitcoin] No UTXOs found for the sender address ${senderAddress}`);
    }

    // 2. Estimate fee rate
    let satPerByte = 1;
    try {
      const estimate = await client.command('estimatesmartfee', 6);
      const feerateBTCperKB = typeof estimate?.feerate === 'number' ? estimate.feerate : Number(estimate?.feerate ?? 0.0001);
      satPerByte = Math.ceil((feerateBTCperKB * 1e8) / 1000) || 1;
    } catch {
      console.warn('[Bitcoin] Failed to estimate fee, falling back to 1 sat/byte');
    }

    // 3. Build transaction locally
    const amountSat = Math.round(amountToken * 1e8);
    const network = (config.wif.startsWith('5') || config.wif.startsWith('K') || config.wif.startsWith('L'))
      ? bitcoin.networks.bitcoin
      : bitcoin.networks.testnet;

    const keyPair = ECPair.fromWIF(config.wif, network);
    const psbt = new bitcoin.Psbt({ network });

    let totalInputSat = 0;
    let inputsAdded = 0;

    for (const utxo of unspents) {
      const txid = utxo.txid;
      const vout = utxo.vout;
      const utxoAmountSat = Math.round(utxo.amount * 1e8);

      // For Legacy (P2PKH) inputs, PSBT requires nonWitnessUtxo (the full transaction hex).
      // This requires the node to have txindex=1 if the transaction is old.
      const rawTx = await client.command('getrawtransaction', txid);
      const nonWitnessUtxo = Buffer.from(rawTx, 'hex');

      psbt.addInput({
        hash: txid,
        index: vout,
        nonWitnessUtxo,
      });

      totalInputSat += utxoAmountSat;
      inputsAdded++;

      // Rough fee estimation: ~148 bytes per input, ~34 bytes per output, ~10 bytes overhead
      const estimatedSize = inputsAdded * 148 + 2 * 34 + 10;
      const estimatedFee = estimatedSize * satPerByte;

      if (totalInputSat >= amountSat + estimatedFee) {
        break;
      }
    }

    if (totalInputSat < amountSat) {
      throw new Error(`[Bitcoin] Insufficient funds: have ${totalInputSat / 1e8} BTC, need ${amountToken} BTC`);
    }

    // Calculate final fee with outputs
    const estimatedSize = inputsAdded * 148 + 2 * 34 + 10;
    const finalFee = estimatedSize * satPerByte;

    if (totalInputSat < amountSat + finalFee) {
      throw new Error(`[Bitcoin] Insufficient funds to cover fees: have ${totalInputSat / 1e8} BTC, need ${(amountSat + finalFee) / 1e8} BTC`);
    }

    psbt.addOutput({
      address: recipientAddress,
      value: BigInt(amountSat),
    });

    const changeSat = totalInputSat - amountSat - finalFee;
    if (changeSat > 546) { // Dust threshold
      psbt.addOutput({
        address: senderAddress,
        value: BigInt(changeSat),
      });
    }

    // 4. Sign locally
    for (let i = 0; i < inputsAdded; i++) {
      psbt.signInput(i, keyPair);
    }

    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();

    // 5. Broadcast using sendrawtransaction (non-wallet command)
    try {
      const txId = await client.command('sendrawtransaction', txHex);
      return { transactionHash: txId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[Bitcoin] Failed to broadcast transaction: ${message}`);
    }
  }
}

export const bitcoinGasTokenNetworkAdapter = new BitcoinGasTokenNetworkAdapter();
