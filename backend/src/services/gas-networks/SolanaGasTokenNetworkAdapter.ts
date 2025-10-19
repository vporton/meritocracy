import { LAMPORTS_PER_SOL, Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

interface SolanaNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl?: string;
  walletAddress?: string;
  secretKeyBase58?: string;
}

const readSolanaConfig = (): SolanaNetworkConfig => ({
  enabled: process.env.SOLANA_ENABLED === 'true',
  networkId: process.env.SOLANA_NETWORK_ID ?? 'solana-mainnet',
  networkName: process.env.SOLANA_NETWORK_NAME ?? 'Solana Mainnet',
  nativeSymbol: process.env.SOLANA_NATIVE_SYMBOL ?? 'SOL',
  nativeDecimals: Number(process.env.SOLANA_NATIVE_DECIMALS ?? '9'),
  rpcUrl: process.env.SOLANA_RPC_URL,
  walletAddress: process.env.SOLANA_WALLET_ADDRESS,
  secretKeyBase58: process.env.SOLANA_SECRET_KEY_BASE58
});

export class SolanaGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'SOLANA';
  private connection?: Connection;
  private signer?: Keypair;

  private getConfig(): SolanaNetworkConfig {
    return readSolanaConfig();
  }

  private ensureEnabledConfig(): SolanaNetworkConfig {
    const config = this.getConfig();
    if (!config.enabled) {
      throw new Error('[Solana] Network disabled');
    }
    if (!config.rpcUrl) {
      throw new Error('[Solana] SOLANA_RPC_URL not configured');
    }
    if (!config.secretKeyBase58) {
      throw new Error('[Solana] SOLANA_SECRET_KEY_BASE58 not configured');
    }
    return config;
  }

  private getConnection(config: SolanaNetworkConfig): Connection {
    if (!this.connection) {
      this.connection = new Connection(config.rpcUrl!, 'confirmed');
    }
    return this.connection;
  }

  private getSigner(config: SolanaNetworkConfig): Keypair {
    if (!this.signer) {
      const secretBase58 = config.secretKeyBase58!;
      const secret = bs58.decode(secretBase58);
      this.signer = Keypair.fromSecretKey(secret);
    }
    return this.signer;
  }

  private getPayerPublicKey(config: SolanaNetworkConfig): PublicKey {
    if (config.walletAddress) {
      return new PublicKey(config.walletAddress);
    }
    return this.getSigner(config).publicKey;
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readSolanaConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.rpcUrl || (!config.walletAddress && !config.secretKeyBase58)) {
      console.warn('⚠️  [Solana] Missing RPC or wallet configuration, skipping.');
      return [];
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [Solana] Token type ${tokenOptions.tokenType} not supported, skipping.`);
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
    const config = this.ensureEnabledConfig();
    const payerKey = this.getPayerPublicKey(config);
    const connection = this.getConnection(config);
    const lamports = await connection.getBalance(payerKey);
    return lamports / 10 ** context.tokenDecimals;
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { solanaAddress?: string | null }).solanaAddress ?? null;
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const config = this.ensureEnabledConfig();
      const connection = this.getConnection(config);
      const signer = this.getSigner(config);
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const lamports = Math.round(amountToken * LAMPORTS_PER_SOL);
      if (lamports <= 0) {
        return { deferReason: 'Transfer amount too small' };
      }
      const transaction = new Transaction({
        feePayer: signer.publicKey,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }).add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: new PublicKey(recipientAddress),
          lamports
        })
      );
      const feeInfo = await connection.getFeeForMessage(transaction.compileMessage());
      const feeLamports = Number(feeInfo.value ?? 0);
      return {
        gasCostToken: feeLamports / LAMPORTS_PER_SOL
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Solana estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureEnabledConfig();
    const connection = this.getConnection(config);
    const signer = this.getSigner(config);

    const lamports = Math.round(amountToken * LAMPORTS_PER_SOL);
    if (lamports <= 0) {
      throw new Error('[Solana] Transfer amount must be greater than zero');
    }

    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: signer.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(recipientAddress),
        lamports
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
      commitment: 'confirmed'
    });

    return { transactionHash: signature };
  }
}

export const solanaGasTokenNetworkAdapter = new SolanaGasTokenNetworkAdapter();
