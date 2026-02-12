import type { User } from '@prisma/client';
import { createPrivateKey } from 'crypto';
import { HttpAgent } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import { AccountIdentifier, LedgerCanister } from '@dfinity/ledger-icp';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';
import { withRetry } from '../../utils/retry.js';

interface IcpNetworkConfig {
  enabled: boolean;
  networkId: string;
  networkName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  host?: string;
  ledgerCanisterId?: string;
  walletAddress?: string;
  identityPem?: string;
  identityPemBase64?: string;
  transferFeeE8s: number;
}

const DEFAULT_ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const DEFAULT_ICP_HOST = 'https://ic0.app';

const readIcpConfig = (): IcpNetworkConfig => {
  const transferFeeE8sRaw = Number(process.env.ICP_TRANSFER_FEE_E8S ?? 10000);
  const transferFeeE8s =
    Number.isFinite(transferFeeE8sRaw) && transferFeeE8sRaw > 0
      ? Math.floor(transferFeeE8sRaw)
      : 10000;

  return {
    enabled: process.env.ICP_ENABLED === 'true',
    networkId: 'icp-mainnet',
    networkName: 'Internet Computer',
    nativeSymbol: 'ICP',
    nativeDecimals: 8,
    host: process.env.ICP_HOST ?? DEFAULT_ICP_HOST,
    ledgerCanisterId: process.env.ICP_LEDGER_CANISTER_ID ?? DEFAULT_ICP_LEDGER_CANISTER_ID,
    walletAddress: process.env.ICP_WALLET_ADDRESS,
    identityPem: process.env.ICP_IDENTITY_PEM,
    identityPemBase64: process.env.ICP_IDENTITY_PEM_BASE64,
    transferFeeE8s
  };
};

const toE8s = (amountToken: number): number => Math.round(amountToken * 1e8);

const fromE8s = (amountE8s: number): number => amountE8s / 1e8;

const ED25519_PKCS8_DER_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const ed25519IdentityFromPem = (pem: string): Ed25519KeyIdentity => {
  const privateKeyObject = createPrivateKey({ key: pem, format: 'pem' });
  const privateKeyDer = privateKeyObject.export({ format: 'der', type: 'pkcs8' });
  const privateKeyBuffer = Buffer.isBuffer(privateKeyDer)
    ? privateKeyDer
    : Buffer.from(privateKeyDer as ArrayBuffer);

  const prefix = privateKeyBuffer.subarray(0, ED25519_PKCS8_DER_PREFIX.length);
  if (!prefix.equals(ED25519_PKCS8_DER_PREFIX)) {
    throw new Error('[ICP] Unsupported Ed25519 private key format');
  }

  const secretKey = privateKeyBuffer.subarray(ED25519_PKCS8_DER_PREFIX.length);
  if (secretKey.length !== 32) {
    throw new Error('[ICP] Invalid Ed25519 private key length');
  }

  return Ed25519KeyIdentity.fromSecretKey(secretKey.buffer.slice(secretKey.byteOffset, secretKey.byteOffset + secretKey.byteLength));
};

export class IcpGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'ICP';
  private agent?: HttpAgent;
  private ledger?: LedgerCanister;
  private identity?: Ed25519KeyIdentity;

  private ensureEnabledConfig(): IcpNetworkConfig {
    const config = readIcpConfig();
    if (!config.enabled) {
      throw new Error('[ICP] Network disabled');
    }
    if (!config.host) {
      throw new Error('[ICP] ICP_HOST not configured');
    }
    if (!config.ledgerCanisterId) {
      throw new Error('[ICP] ICP_LEDGER_CANISTER_ID not configured');
    }
    if (!config.identityPem && !config.identityPemBase64) {
      throw new Error('[ICP] ICP_IDENTITY_PEM or ICP_IDENTITY_PEM_BASE64 not configured');
    }
    return config;
  }

  private getIdentity(config: IcpNetworkConfig): Ed25519KeyIdentity {
    if (!this.identity) {
      const pem = config.identityPemBase64
        ? Buffer.from(config.identityPemBase64, 'base64').toString('utf-8')
        : config.identityPem;
      if (!pem) {
        throw new Error('[ICP] Missing identity PEM');
      }
      this.identity = ed25519IdentityFromPem(pem);
    }
    return this.identity;
  }

  private getAgent(config: IcpNetworkConfig): HttpAgent {
    if (!this.agent) {
      this.agent = new HttpAgent({
        host: config.host,
        identity: this.getIdentity(config)
      });
    }
    return this.agent;
  }

  private getLedger(config: IcpNetworkConfig): LedgerCanister {
    if (!this.ledger) {
      this.ledger = LedgerCanister.create({
        agent: this.getAgent(config),
        canisterId: config.ledgerCanisterId
      });
    }
    return this.ledger;
  }

  private formatAccountIdentifier(accountIdentifier: AccountIdentifier): string {
    const maybeHex = (accountIdentifier as unknown as { toHex?: () => string }).toHex;
    if (maybeHex) {
      return maybeHex.call(accountIdentifier);
    }
    return accountIdentifier.toString();
  }

  private getAccountIdentifierForPrincipal(principal: Principal): AccountIdentifier {
    const creator = AccountIdentifier as unknown as {
      fromPrincipal: (args: { principal: Principal }) => AccountIdentifier;
    };
    return creator.fromPrincipal({ principal });
  }

  private resolveAccountIdentifier(address: string): AccountIdentifier {
    const trimmed = address.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const creator = AccountIdentifier as unknown as {
        fromHex: (value: string) => AccountIdentifier;
      };
      return creator.fromHex(trimmed);
    }
    const principal = Principal.fromText(trimmed);
    return this.getAccountIdentifierForPrincipal(principal);
  }

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const config = readIcpConfig();
    if (!config.enabled) {
      return [];
    }

    if (!config.ledgerCanisterId || !config.host || (!config.identityPem && !config.identityPemBase64)) {
      console.warn('⚠️  [ICP] Missing ICP ledger or identity configuration, skipping.');
      return [];
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  [ICP] Token type ${tokenOptions.tokenType} not supported, skipping.`);
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
        walletAddress: config.walletAddress ?? this.resolveWalletAddress(config),
        defaultGasCostToken: fromE8s(config.transferFeeE8s)
      }
    ];
  }

  private resolveWalletAddress(config: IcpNetworkConfig): string | undefined {
    if (config.walletAddress) {
      return config.walletAddress;
    }
    try {
      const principal = this.getIdentity(config).getPrincipal();
      const accountIdentifier = this.getAccountIdentifierForPrincipal(principal);
      return this.formatAccountIdentifier(accountIdentifier);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  [ICP] Failed to derive wallet address: ${message}`);
      return config.walletAddress;
    }
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const config = this.ensureEnabledConfig();
    const ledger = this.getLedger(config);
    const walletAddress = context.walletAddress ?? this.resolveWalletAddress(config);
    if (!walletAddress) {
      throw new Error('[ICP] Wallet address not configured');
    }
    const accountIdentifier = this.resolveAccountIdentifier(walletAddress);
    const balance = await withRetry(
      () => ledger.accountBalance({ accountIdentifier }),
      { taskName: 'ICP accountBalance' }
    );
    const balanceValue = balance as unknown as { e8s?: bigint; toE8s?: () => bigint };
    const e8s = balanceValue.toE8s ? balanceValue.toE8s() : balanceValue.e8s ?? BigInt(0);
    return fromE8s(Number(e8s));
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return (user as User & { icpAddress?: string | null }).icpAddress ?? null;
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    try {
      const config = this.ensureEnabledConfig();
      const amountE8s = toE8s(amountToken);
      if (amountE8s <= 0) {
        return { deferReason: 'Transfer amount too small' };
      }
      this.resolveAccountIdentifier(recipientAddress);
      return { gasCostToken: fromE8s(config.transferFeeE8s) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ICP estimation error';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const config = this.ensureEnabledConfig();
    const ledger = this.getLedger(config);
    const amountE8s = toE8s(amountToken);
    if (amountE8s <= 0) {
      throw new Error('[ICP] Transfer amount must be greater than zero');
    }

    const accountIdentifier = this.resolveAccountIdentifier(recipientAddress);
    const amount = { e8s: BigInt(amountE8s) };
    const fee = { e8s: BigInt(config.transferFeeE8s) };

    const blockHeight = await withRetry(
      () =>
        ledger.transfer({
          to: accountIdentifier,
          amount,
          fee,
          memo: BigInt(0)
        }),
      { taskName: 'ICP transfer' }
    );

    return { transactionHash: String(blockHeight) };
  }

  async deriveAddress(privateKey: string): Promise<string> {
    const pem = privateKey.trim().startsWith('-----BEGIN')
      ? privateKey
      : Buffer.from(privateKey, 'base64').toString('utf-8');
    const identity = ed25519IdentityFromPem(pem);
    const principal = identity.getPrincipal();
    const accountIdentifier = this.getAccountIdentifierForPrincipal(principal);
    return this.formatAccountIdentifier(accountIdentifier);
  }
}

export const icpGasTokenNetworkAdapter = new IcpGasTokenNetworkAdapter();
