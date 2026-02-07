import type { User } from '@prisma/client';
import { systemSecretService } from '../SystemSecretService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';

type DisplayAddress = { label: string; address?: string };

type IcpNetworkConfig = {
  enabled: boolean;
  networkId: string;
  networkName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  walletAddress?: string;
  displayAddresses?: { label: string; address: string }[];
};

const normalizeAddressEntries = (entries: DisplayAddress[]): { label: string; address: string }[] => {
  return entries.map(entry => ({
    label: entry.label,
    address: entry.address?.trim() || 'Not set'
  }));
};

const formatAmount = (amount: number, decimals: number): string => {
  return amount.toLocaleString('en-US', {
    maximumFractionDigits: decimals
  });
};

const readIcpNetworkConfigs = async (): Promise<IcpNetworkConfig[]> => {
  const icpWalletAddress = (await systemSecretService.getSecret('ICP_WALLET_ADDRESS'))?.trim();

  const ckbtcTokenAddress = (await systemSecretService.getSecret('CKBTC_NATIVE_ADDRESS'))?.trim();
  const ckbtcIcpAddress =
    (await systemSecretService.getSecret('CKBTC_ICP_ADDRESS'))?.trim() || icpWalletAddress;

  const ckethTokenAddress = (await systemSecretService.getSecret('CKETH_NATIVE_ADDRESS'))?.trim();
  const ckethIcpAddress =
    (await systemSecretService.getSecret('CKETH_ICP_ADDRESS'))?.trim() || icpWalletAddress;

  const ckusdcTokenAddress = (await systemSecretService.getSecret('CKUSDC_NATIVE_ADDRESS'))?.trim();
  const ckusdcIcpAddress =
    (await systemSecretService.getSecret('CKUSDC_ICP_ADDRESS'))?.trim() || icpWalletAddress;

  const ckeurcTokenAddress = (await systemSecretService.getSecret('CKEURC_NATIVE_ADDRESS'))?.trim();
  const ckeurcIcpAddress =
    (await systemSecretService.getSecret('CKEURC_ICP_ADDRESS'))?.trim() || icpWalletAddress;

  return [
    {
      enabled: process.env.ICP_ENABLED === 'true',
      networkId: 'icp-mainnet',
      networkName: 'Internet Computer',
      tokenSymbol: 'ICP',
      tokenDecimals: 8,
      walletAddress: icpWalletAddress
    },
    // ck* tokens live on ICP and pay transaction fees in the same ck token.
    // We treat them as gas tokens because fees are charged in the asset itself on ICP.
    {
      enabled: process.env.CKBTC_ENABLED === 'true',
      networkId: 'ckbtc-icp',
      networkName: 'ckBTC (ICP)',
      tokenSymbol: 'ckBTC',
      tokenDecimals: 8,
      walletAddress: ckbtcIcpAddress ?? ckbtcTokenAddress,
      displayAddresses: normalizeAddressEntries([
        { label: 'Token-native address', address: ckbtcTokenAddress },
        { label: 'ICP wallet address', address: ckbtcIcpAddress }
      ])
    },
    {
      enabled: process.env.CKETH_ENABLED === 'true',
      networkId: 'cketh-icp',
      networkName: 'ckETH (ICP)',
      tokenSymbol: 'ckETH',
      tokenDecimals: 18,
      walletAddress: ckethIcpAddress ?? ckethTokenAddress,
      displayAddresses: normalizeAddressEntries([
        { label: 'Token-native address', address: ckethTokenAddress },
        { label: 'ICP wallet address', address: ckethIcpAddress }
      ])
    },
    {
      enabled: process.env.CKUSDC_ENABLED === 'true',
      networkId: 'ckusdc-icp',
      networkName: 'ckUSDC (ICP)',
      tokenSymbol: 'ckUSDC',
      tokenDecimals: 6,
      walletAddress: ckusdcIcpAddress ?? ckusdcTokenAddress,
      displayAddresses: normalizeAddressEntries([
        { label: 'Token-native address', address: ckusdcTokenAddress },
        { label: 'ICP wallet address', address: ckusdcIcpAddress }
      ])
    },
    {
      enabled: process.env.CKEURC_ENABLED === 'true',
      networkId: 'ckeurc-icp',
      networkName: 'ckEURC (ICP)',
      tokenSymbol: 'ckEURC',
      tokenDecimals: 6,
      walletAddress: ckeurcIcpAddress ?? ckeurcTokenAddress,
      displayAddresses: normalizeAddressEntries([
        { label: 'Token-native address', address: ckeurcTokenAddress },
        { label: 'ICP wallet address', address: ckeurcIcpAddress }
      ])
    }
  ];
};

export class IcpGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'ICP';

  async getNetworkContexts(_tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const configs = await readIcpNetworkConfigs();
    return configs
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
        walletAddress: config.walletAddress,
        displayAddresses: config.displayAddresses
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
      deferReason: 'ICP transfers are not automated yet.'
    };
  }

  async sendTransfer(
    _context: GasTokenNetworkContext,
    _recipientAddress: string,
    _amountToken: number
  ): Promise<GasTransferResult> {
    throw new Error('ICP transfers are not automated yet.');
  }
}

export const icpGasTokenNetworkAdapter = new IcpGasTokenNetworkAdapter();
