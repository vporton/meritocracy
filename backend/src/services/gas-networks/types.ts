import type { User } from '@prisma/client';
import type { TokenDescriptor, TokenType } from '../../types/token.js';

export type GasTokenNetworkType = 'EVM' | 'SOLANA' | 'BITCOIN' | 'POLKADOT' | 'COSMOS';

export interface TokenDistributionOptions {
  tokenType?: TokenType;
}

export interface GasTokenNetworkContext extends TokenDescriptor {
  adapterType: GasTokenNetworkType;
  networkId: string;
  networkName: string;
  nativeTokenSymbol: string;
  nativeTokenDecimals: number;
  walletAddress?: string;
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
    amountToken: number
  ): Promise<GasTransferEstimate>;
  sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult>;
}
