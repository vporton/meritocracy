import type { User } from '@prisma/client';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  GasTransferResult,
  TokenDistributionOptions
} from './types.js';
import { multiNetworkEthereumService } from '../MultiNetworkEthereumService.js';

export class EvmGasTokenNetworkAdapter implements GasTokenNetworkAdapter {
  readonly type = 'EVM';

  async getNetworkContexts(tokenOptions: TokenDistributionOptions): Promise<GasTokenNetworkContext[]> {
    const contexts: GasTokenNetworkContext[] = [];
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();

    for (const networkName of enabledNetworks) {
      const config = multiNetworkEthereumService.getNetworkConfig(networkName);
      if (!config) {
        console.warn(`⚠️  [EVM] Missing network config for ${networkName}, skipping.`);
        continue;
      }

      if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
        console.warn(`⚠️  [EVM] Token type ${tokenOptions.tokenType} not supported for ${networkName}, skipping.`);
        continue;
      }

      const nativeMetadata = multiNetworkEthereumService.getNativeTokenMetadata(networkName);

      contexts.push({
        adapterType: this.type,
        networkId: networkName,
        networkName,
        tokenType: 'NATIVE',
        tokenSymbol: nativeMetadata.symbol,
        tokenDecimals: nativeMetadata.decimals,
        nativeTokenSymbol: nativeMetadata.symbol,
        nativeTokenDecimals: nativeMetadata.decimals
      });
    }

    return contexts;
  }

  async getWalletBalance(context: GasTokenNetworkContext): Promise<number> {
    const balanceRaw = await multiNetworkEthereumService.getTokenBalance(context.networkId, context);
    return Number(multiNetworkEthereumService.formatUnits(balanceRaw, context.tokenDecimals));
  }

  async getDynamicGasReserve(context: GasTokenNetworkContext): Promise<number> {
    if (context.tokenType !== 'NATIVE') {
      return 0;
    }

    try {
      const gasPriceWei = await multiNetworkEthereumService.getGasPrice(context.networkId);
      const gasPrice = Number(
        multiNetworkEthereumService.formatUnits(gasPriceWei, context.nativeTokenDecimals)
      );
      return Math.max(0.3 * gasPrice, 0.001);
    } catch (error) {
      console.warn(`⚠️  [EVM] Failed to get gas price for ${context.networkName}, using minimum reserve.`);
      return 0.001;
    }
  }

  formatAmount(context: GasTokenNetworkContext, amountToken: number): string {
    return amountToken.toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: context.tokenDecimals
    });
  }

  getRecipientAddress(user: User): string | null {
    return user.ethereumAddress ?? null;
  }

  async estimateTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferEstimate> {
    const amountAsString = this.formatAmount(context, amountToken);

    try {
      const estimate = await multiNetworkEthereumService.estimateTokenTransferCost({
        networkName: context.networkId,
        token: context,
        to: recipientAddress as `0x${string}`,
        amount: amountAsString
      });

      const gasCostToken = Number(
        multiNetworkEthereumService.formatUnits(estimate.gasCostWei, context.nativeTokenDecimals)
      );

      return { gasCostToken };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to estimate gas cost';
      return { deferReason: message };
    }
  }

  async sendTransfer(
    context: GasTokenNetworkContext,
    recipientAddress: string,
    amountToken: number
  ): Promise<GasTransferResult> {
    const amountAsString = this.formatAmount(context, amountToken);

    const transactionHash = await multiNetworkEthereumService.sendTokenTransfer({
      networkName: context.networkId,
      token: context,
      to: recipientAddress as `0x${string}`,
      amount: amountAsString
    });

    return { transactionHash };
  }
}

export const evmGasTokenNetworkAdapter = new EvmGasTokenNetworkAdapter();
