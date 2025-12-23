import type { User } from '@prisma/client';
import type { TokenDescriptor, TokenType } from '../../types/token.js';

export type GasTokenNetworkType = 'EVM' | 'SOLANA' | 'BITCOIN' | 'POLKADOT' | 'COSMOS' | 'STELLAR';

export interface TokenDistributionOptions {
  tokenType?: TokenType;
  country?: string;
}

export interface GasTokenNetworkContext extends TokenDescriptor {
  adapterType: GasTokenNetworkType;
  networkId: string;
  networkName: string;
  nativeTokenSymbol: string;
  nativeTokenDecimals: number;
  walletAddress?: string;
  defaultGasCostToken?: number;
  privateKey?: string;
  country?: string;
}

export interface GasTransferEstimate {
  gasCostToken?: number;
  deferReason?: string;
  shouldHalt?: boolean;
}

export interface GasTransferResult {
  transactionHash?: string;
  metadata?: Record<string, unknown>;
}

export interface GasTokenNetworkAdapter {
  readonly type: GasTokenNetworkType;
  getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]>;
  getWalletBalance(context: GasTokenNetworkContext): Promise<number>;
  formatAmount(context: GasTokenNetworkContext, amountToken: number): string;
  getRecipientAddress(user: User): string | null;
  estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number,
    privateKey?: string
  ): Promise<GasTransferEstimate>;
  sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number,
    privateKey?: string
  ): Promise<GasTransferResult>;
  deriveAddress?(privateKey: string): Promise<string>;
}
