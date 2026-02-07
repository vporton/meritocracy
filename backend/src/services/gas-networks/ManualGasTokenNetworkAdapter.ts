import type { User } from '@prisma/client';
import { systemSecretService } from '../SystemSecretService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

type ManualNetworkConfig = {
  enabled: boolean;
  networkId: string;
  networkName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  walletAddress?: string;
};

const formatAmount = (amount: number, decimals: number): string => {
  return amount.toLocaleString('en-US', {
    maximumFractionDigits: decimals
  });
};

const readManualNetworkConfigs = async (): Promise<ManualNetworkConfig[]> => [
  {
    enabled: process.env.BCH_ENABLED === 'true',
    networkId: 'bch-mainnet',
    networkName: 'Bitcoin Cash',
    tokenSymbol: 'BCH',
    tokenDecimals: 8,
    walletAddress: (await systemSecretService.getSecret('BCH_WALLET_ADDRESS'))?.trim()
  },
  {
    enabled: process.env.GLRM_ENABLED === 'true',
    networkId: 'glrm-mainnet',
    networkName: 'GLRM',
    tokenSymbol: 'GLRM',
    tokenDecimals: 8,
    walletAddress: (await systemSecretService.getSecret('GLRM_WALLET_ADDRESS'))?.trim()
  }
];

export class ManualGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'MANUAL';

  async getNetworkContexts(_tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    return (await readManualNetworkConfigs())
      .filter(config => config.enabled)
      .map(config => ({
        adapterType: this.type,
        networkId: config.networkId,
        networkName: config.networkName,
        tokenSymbol: config.tokenSymbol,
        tokenDecimals: config.tokenDecimals,
        tokenType: 'NATIVE',
        nativeTokenSymbol: config.tokenSymbol,
        nativeTokenDecimals: config.tokenDecimals,
        walletAddress: config.walletAddress
      }));
  }

  async getWalletBalance(_context: GasTokenNetworkContext): Promise<number> {
    return 0;
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return formatAmount(amountToken, context.tokenDecimals);
  }

  getRecipientAddress(_user: User): string | null {
    return null;
  }

  async estimateTransfer(
    _context: GasTokenNetworkContext,
    _recipientAddress: string,
    _amountToken: number
  ): Promise<GasTransferEstimate> {
    return {
      shouldHalt: true,
      deferReason: 'Manual networks are not automated yet.'
    };
  }

  async sendTransfer(
    _context: GasTokenNetworkContext,
    _recipientAddress: string,
    _amountToken: number
  ): Promise<GasTransferResult> {
    throw new Error('Manual network transfers are not automated yet.');
  }
}

export const manualGasTokenNetworkAdapter = new ManualGasTokenNetworkAdapter();
