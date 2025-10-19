import { PrismaClient } from '@prisma/client';
import type { User } from '@prisma/client';
import type { TokenType } from '../types/token.js';
import { multiNetworkEthereumService } from './MultiNetworkEthereumService.js';
import type {
  GasTokenNetworkAdapter,
  GasTokenNetworkContext,
  GasTransferEstimate,
  TokenDistributionOptions
} from './gas-networks/types.js';
import {
  bitcoinGasTokenNetworkAdapter,
  evmGasTokenNetworkAdapter,
  polkadotGasTokenNetworkAdapter,
  solanaGasTokenNetworkAdapter
} from './gas-networks/index.js';

export interface DistributionFiber {
  userId: number;
  recipientAddress: string;
  amountToken: number;
  shareInGDP: number;
  backlogToken?: number;
}

export interface NetworkDistributionResult {
  networkId: string;
  networkName: string;
  adapterType: string;
  tokenSymbol: string;
  tokenType: TokenType;
  tokenDecimals: number;
  distributedAmount: number;
  reservedAmount: number;
  distributions: Array<{
    userId: number;
    amount: number;
    status: 'SENT' | 'DEFERRED' | 'FAILED';
    transactionHash?: string;
    errorMessage?: string;
    gasCostToken?: number;
  }>;
  errors: string[];
  distributed?: number;
  reserved?: number;
}

export interface MultiNetworkDistributionResult {
  success: boolean;
  totalDistributedAmount: number;
  totalReservedAmount: number;
  networkResults: Map<string, NetworkDistributionResult>;
  errors: string[];
  totalDistributed?: number;
  totalReserved?: number;
}

type ReserveStatusEntry = {
  tokenSymbol: string;
  tokenType: TokenType;
  tokenDecimals: number;
  nativeTokenSymbol: string;
  totalReserve: number;
  walletBalance: number;
  availableForDistribution: number;
  lastDistribution: Date | null;
  adapterType: string;
  networkName: string;
  name?: string;
  chainId?: number;
  address?: string;
  balance?: string;
  gasPrice?: string;
  balanceFormatted?: string;
  gasPriceFormatted?: string;
};

type AdapterContextEntry = {
  adapter: GasTokenNetworkAdapter;
  context: GasTokenNetworkContext;
};

export class MultiNetworkGasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly GAS_COST_VALUE_MULTIPLIER = 5;
  private readonly defaultTokenOptions: TokenDistributionOptions;
  private readonly networkAdapters: GasTokenNetworkAdapter[];

  constructor(
    prisma: PrismaClient,
    adapters?: GasTokenNetworkAdapter[],
    defaultTokenOptions?: TokenDistributionOptions
  ) {
    this.prisma = prisma;
    this.networkAdapters =
      adapters ??
      [
        evmGasTokenNetworkAdapter,
        solanaGasTokenNetworkAdapter,
        bitcoinGasTokenNetworkAdapter,
        polkadotGasTokenNetworkAdapter
      ];

    this.defaultTokenOptions = {
      tokenType: defaultTokenOptions?.tokenType ?? 'NATIVE'
    };
  }

  private async collectNetworkAdapterContexts(
    tokenOptions: TokenDistributionOptions
  ): Promise<Map<string, AdapterContextEntry>> {
    const contextEntries = new Map<string, AdapterContextEntry>();

    for (const adapter of this.networkAdapters) {
      let contexts: GasTokenNetworkContext[] = [];
      try {
        contexts = await adapter.getNetworkContexts(tokenOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to load contexts for adapter ${adapter.type}: ${message}`);
        continue;
      }

      for (const context of contexts) {
        contextEntries.set(context.networkId, { adapter, context });
      }
    }

    return contextEntries;
  }

  private resolveTokenOptions(overrides?: TokenDistributionOptions): TokenDistributionOptions {
    return {
      tokenType: overrides?.tokenType ?? this.defaultTokenOptions.tokenType
    };
  }

  private async fetchEligibleUsers(): Promise<User[]> {
    return await this.prisma.user.findMany({
      where: {
        onboarded: true,
        shareInGDP: { not: null }
      },
      orderBy: {
        shareInGDP: 'desc'
      }
    });
  }

  private async getTokenReserve(context: GasTokenNetworkContext): Promise<number> {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      }
    });
    return reserve ? Number(reserve.totalReserve) : 0;
  }

  private async updateGasTokenReserve(context: GasTokenNetworkContext, amount: number): Promise<void> {
    await this.prisma.gasTokenReserve.upsert({
      where: {
        network_tokenSymbol_tokenType: {
          network: context.networkId,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        }
      },
      update: {
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenDecimals: context.tokenDecimals
      },
      create: {
        network: context.networkId,
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenType: context.tokenType,
        tokenSymbol: context.tokenSymbol,
        tokenDecimals: context.tokenDecimals
      }
    });
  }

  private async calculateDistributions(
    tokenOptions: TokenDistributionOptions
  ): Promise<
    Map<
      string,
      {
        adapter: GasTokenNetworkAdapter;
        context: GasTokenNetworkContext;
        distributions: DistributionFiber[];
      }
    >
  > {
    const users = await this.fetchEligibleUsers();
    if (users.length === 0) {
      return new Map();
    }

    const networkDistributions = new Map<
      string,
      {
        adapter: GasTokenNetworkAdapter;
        context: GasTokenNetworkContext;
        distributions: DistributionFiber[];
      }
    >();

    for (const adapter of this.networkAdapters) {
      let contexts: GasTokenNetworkContext[] = [];
      try {
        contexts = await adapter.getNetworkContexts(tokenOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to load contexts for adapter ${adapter.type}: ${message}`);
        continue;
      }

      for (const context of contexts) {
        const eligibleUsers = users.filter(user => {
          const share = user.shareInGDP ?? 0;
          const address = adapter.getRecipientAddress(user);
          return share > 0 && !!address;
        });

        const totalShare = eligibleUsers.reduce((sum, user) => sum + (user.shareInGDP ?? 0), 0);
        if (eligibleUsers.length === 0 || totalShare <= 0) {
          console.warn(
            `⚠️  No eligible recipients found for ${context.networkName} (${context.adapterType}).`
          );
          networkDistributions.set(context.networkId, {
            adapter,
            context,
            distributions: []
          });
          continue;
        }

        let walletBalance = 0;
        try {
          walletBalance = await adapter.getWalletBalance(context);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(
            `❌ Failed to read wallet balance for ${context.networkName} (${context.adapterType}): ${message}`
          );
          networkDistributions.set(context.networkId, {
            adapter,
            context,
            distributions: []
          });
          continue;
        }

        const currentReserve = await this.getTokenReserve(context);
        const spendableFromWallet = Math.max(0, walletBalance);
        const totalAvailable = spendableFromWallet + currentReserve;

        if (totalAvailable <= 0) {
          console.warn(
            `⚠️  No ${context.tokenSymbol} funds available for distribution on ${context.networkName}`
          );
          networkDistributions.set(context.networkId, {
            adapter,
            context,
            distributions: []
          });
          continue;
        }

        const distributions: DistributionFiber[] = eligibleUsers.map(user => {
          const share = user.shareInGDP ?? 0;
          const proportion = share / totalShare;
          const recipientAddress = adapter.getRecipientAddress(user);

          return {
            userId: user.id,
            recipientAddress: recipientAddress!,
            amountToken: proportion > 0 ? spendableFromWallet * proportion : 0,
            shareInGDP: share
          };
        });

        const deferredRows = await this.prisma.gasTokenDistribution.findMany({
          where: {
            network: context.networkId,
            tokenSymbol: context.tokenSymbol,
            tokenType: context.tokenType,
            status: 'DEFERRED'
          },
          select: {
            userId: true,
            amount: true
          }
        });
        const backlogLookup = new Map<number, number>();
        for (const row of deferredRows) {
          const previous = backlogLookup.get(row.userId) ?? 0;
          backlogLookup.set(row.userId, previous + Number(row.amount));
        }

        for (const dist of distributions) {
          dist.backlogToken = backlogLookup.get(dist.userId) ?? 0;
          dist.amountToken += dist.backlogToken;
        }

        const filtered = distributions.filter(dist => dist.amountToken > 0);
        filtered.sort((a, b) => b.amountToken - a.amountToken);

        networkDistributions.set(context.networkId, {
          adapter,
          context,
          distributions: filtered
        });
      }
    }

    return networkDistributions;
  }

  private buildGasCostMessage(
    context: GasTokenNetworkContext,
    gasCostToken: number,
    amountToken: number
  ): string {
    const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
    return `Transfer amount ${amountToken.toFixed(6)} ${context.tokenSymbol} must exceed ${minimumRequired.toFixed(
      6
    )} ${context.tokenSymbol} to stay ${this.GAS_COST_VALUE_MULTIPLIER}x above the estimated gas cost (${gasCostToken.toFixed(
      6
    )} ${context.tokenSymbol})`;
  }

  private async processNetworkDistribution(
    adapter: GasTokenNetworkAdapter,
    context: GasTokenNetworkContext,
    distributions: DistributionFiber[]
  ): Promise<NetworkDistributionResult> {
    const result: NetworkDistributionResult = {
      networkId: context.networkId,
      networkName: context.networkName,
      adapterType: context.adapterType,
      tokenSymbol: context.tokenSymbol,
      tokenType: context.tokenType,
      tokenDecimals: context.tokenDecimals,
      distributedAmount: 0,
      reservedAmount: 0,
      distributions: [],
      errors: []
    };

    console.log(
      `🔄 Processing ${distributions.length} ${context.tokenSymbol} distributions on ${context.networkName} (${context.adapterType})...`
    );

    let remainingAmount = distributions.reduce((sum, dist) => sum + dist.amountToken, 0);

    for (const dist of distributions) {
      try {
        if (remainingAmount <= 0) {
          break;
        }

        if (dist.amountToken > remainingAmount) {
          dist.amountToken = remainingAmount;
        }

        let gasCostToken: number | undefined;
        let estimationError: string | undefined;
        let shouldStopDueToGasCost = false;
        let totalCostToken = dist.amountToken;

        let estimate: GasTransferEstimate | undefined;
        try {
          estimate = await adapter.estimateTransfer(
            context,
            dist.recipientAddress,
            dist.amountToken
          );
        } catch (error) {
          estimationError = error instanceof Error ? error.message : 'Failed to estimate gas cost';
        }

        if (estimate?.gasCostToken !== undefined) {
          gasCostToken = estimate.gasCostToken;
          const totalRequired = dist.amountToken + gasCostToken;
          if (totalRequired > remainingAmount + Number.EPSILON) {
            const adjustedAmount = Math.max(0, remainingAmount - gasCostToken);
            if (adjustedAmount <= 0) {
              estimationError = `Insufficient ${context.tokenSymbol} to cover gas cost of ${gasCostToken.toFixed(
                6
              )} ${context.tokenSymbol}`;
              shouldStopDueToGasCost = true;
            } else {
              dist.amountToken = adjustedAmount;
            }
          }

          const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
          if (!estimationError && dist.amountToken <= minimumRequired) {
            estimationError = this.buildGasCostMessage(context, gasCostToken, dist.amountToken);
            shouldStopDueToGasCost = true;
          }

          totalCostToken = dist.amountToken + gasCostToken;
        } else {
          totalCostToken = dist.amountToken;
        }

        if (estimate?.deferReason) {
          estimationError = estimate.deferReason;
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'DEFERRED',
              errorMessage: estimationError,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'DEFERRED',
            errorMessage: estimationError,
            gasCostToken
          });

          console.log(
            `⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`
          );
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);
          if (shouldStopDueToGasCost) {
            console.log(
              `🛑 [${context.networkName}] Halting further distributions due to gas cost threshold.`
            );
            break;
          }
          continue;
        }

        try {
          const transferResult = await adapter.sendTransfer(
            context,
            dist.recipientAddress,
            dist.amountToken
          );

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'SENT',
              transactionHash: transferResult.transactionHash,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'SENT',
            transactionHash: transferResult.transactionHash,
            gasCostToken
          });

          result.distributedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - totalCostToken);

          const gasInfo =
            gasCostToken !== undefined
              ? ` (gas ${gasCostToken.toFixed(6)} ${context.tokenSymbol})`
              : '';
          console.log(
            `✅ [${context.networkName}] Sent ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} to user ${dist.userId}${gasInfo}`
          );
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkId,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'FAILED',
              errorMessage,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'FAILED',
            errorMessage,
            gasCostToken
          });

          const message = `Failed to send to user ${dist.userId}: ${errorMessage}`;
          result.errors.push(message);
          console.error(`❌ [${context.networkName}] ${message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
        console.error(
          `❌ [${context.networkName}] Error processing user ${dist.userId}: ${errorMessage}`
        );
      }
    }

    const currentReserve = await this.getTokenReserve(context);
    const newReserve = currentReserve + result.reservedAmount;
    await this.updateGasTokenReserve(context, newReserve);

    console.log(
      `📊 [${context.networkName}] Distribution completed: ${result.distributedAmount.toFixed(
        6
      )} ${context.tokenSymbol} distributed, ${result.reservedAmount.toFixed(
        6
      )} ${context.tokenSymbol} reserved`
    );

    return {
      ...result,
      distributed: result.distributedAmount,
      reserved: result.reservedAmount
    };
  }

  async processMultiNetworkDistribution(
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<MultiNetworkDistributionResult> {
    const tokenOptions = this.resolveTokenOptions(overrides);
    console.log('🔄 Starting multi-network gas token distribution...');

    try {
      const networkDistributions = await this.calculateDistributions(tokenOptions);
      const networkResults = new Map<string, NetworkDistributionResult>();
      let totalDistributedAmount = 0;
      let totalReservedAmount = 0;
      const errors: string[] = [];

      const networkPromises = Array.from(networkDistributions.entries()).map(
        async ([networkId, payload]) => {
          const { adapter, context, distributions } = payload;

          try {
            if (distributions.length === 0) {
              networkResults.set(networkId, {
                networkId: context.networkId,
                networkName: context.networkName,
                adapterType: context.adapterType,
                tokenSymbol: context.tokenSymbol,
                tokenType: context.tokenType,
                tokenDecimals: context.tokenDecimals,
                distributedAmount: 0,
                reservedAmount: 0,
                distributions: [],
                errors: [],
                distributed: 0,
                reserved: 0
              });
              return;
            }

            const networkResult = await this.processNetworkDistribution(
              adapter,
              context,
              distributions
            );
            networkResults.set(networkId, networkResult);
            totalDistributedAmount += networkResult.distributedAmount;
            totalReservedAmount += networkResult.reservedAmount;

            errors.push(
              ...networkResult.errors.map(error => `[${context.networkName}] ${error}`)
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`[${context.networkName}] Fatal error: ${errorMessage}`);
            console.error(`💥 [${context.networkName}] Fatal error:`, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      const result: MultiNetworkDistributionResult = {
        success: errors.length === 0,
        totalDistributedAmount,
        totalReservedAmount,
        totalDistributed: totalDistributedAmount,
        totalReserved: totalReservedAmount,
        networkResults,
        errors
      };

      console.log('📊 Multi-network gas token distribution completed:');
      console.log(`  💰 Total distributed: ${totalDistributedAmount.toFixed(6)} tokens`);
      console.log(`  🏦 Total reserved: ${totalReservedAmount.toFixed(6)} tokens`);

      for (const [, networkResult] of networkResults) {
        console.log(
          `  🌐 [${networkResult.networkName}]: ${networkResult.distributedAmount.toFixed(
            6
          )} ${networkResult.tokenSymbol} distributed, ${networkResult.reservedAmount.toFixed(
            6
          )} ${networkResult.tokenSymbol} reserved`
        );
        console.log(
          `    ✅ Successful: ${
            networkResult.distributions.filter(d => d.status === 'SENT').length
          }`
        );
        console.log(
          `    ⏳ Deferred: ${
            networkResult.distributions.filter(d => d.status === 'DEFERRED').length
          }`
        );
        console.log(
          `    ❌ Failed: ${
            networkResult.distributions.filter(d => d.status === 'FAILED').length
          }`
        );
      }

      if (errors.length > 0) {
        console.log('⚠️  Errors occurred:');
        errors.forEach(error => console.log(`  - ${error}`));
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('💥 Fatal error in multi-network gas token distribution:', errorMessage);

      return {
        success: false,
        totalDistributedAmount: 0,
        totalReservedAmount: 0,
        totalDistributed: 0,
        totalReserved: 0,
        networkResults: new Map(),
        errors: [errorMessage]
      };
    }
  }

  async getUserDistributionHistory(userId: number) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { userId },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getNetworkDistributionHistory(networkId: string) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { network: networkId },
      include: {
        user: true
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getAllDistributionHistory() {
    return await this.prisma.gasTokenDistribution.findMany({
      include: {
        user: true
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  async getReserveStatus(
    overrides?: Partial<TokenDistributionOptions>,
    contextEntries?: Map<string, AdapterContextEntry>
  ) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contexts = contextEntries ?? (await this.collectNetworkAdapterContexts(tokenOptions));
    const reserveStatus = new Map<string, ReserveStatusEntry>();

    for (const [networkId, { adapter, context }] of contexts.entries()) {
      const reserveRow = await this.prisma.gasTokenReserve.findUnique({
        where: {
          network_tokenSymbol_tokenType: {
            network: context.networkId,
            tokenSymbol: context.tokenSymbol,
            tokenType: context.tokenType
          }
        }
      });
      let walletBalance = 0;
      try {
        walletBalance = await adapter.getWalletBalance(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(
          `⚠️  Failed to read wallet balance for reserve status on ${context.networkName}: ${message}`
        );
      }
      const reserveAmount = reserveRow ? Number(reserveRow.totalReserve) : 0;
      const availableForDistribution = walletBalance + reserveAmount;

      reserveStatus.set(networkId, {
        tokenSymbol: context.tokenSymbol,
        tokenType: context.tokenType,
        tokenDecimals: context.tokenDecimals,
        nativeTokenSymbol: context.nativeTokenSymbol,
        totalReserve: reserveAmount,
        walletBalance,
        availableForDistribution,
        lastDistribution: reserveRow?.lastDistribution ?? null,
        adapterType: context.adapterType,
        networkName: context.networkName,
        address: context.walletAddress
      });
    }

    return reserveStatus;
  }

  async getEnabledNetworks(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const networks = new Map<
      string,
      { networkId: string; networkName: string; adapterType: string }
    >();

    for (const adapter of this.networkAdapters) {
      try {
        const contexts = await adapter.getNetworkContexts(tokenOptions);
        for (const context of contexts) {
          networks.set(context.networkId, {
            networkId: context.networkId,
            networkName: context.networkName,
            adapterType: context.adapterType
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `❌ Failed to enumerate networks for adapter ${adapter.type}: ${message}`
        );
      }
    }

    return Array.from(networks.values());
  }

  async getNetworkStatus(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const contextEntries = await this.collectNetworkAdapterContexts(tokenOptions);
    const status = await this.getReserveStatus(overrides, contextEntries);

    try {
      const networkInfo = await multiNetworkEthereumService.getAllNetworkInfo();
      for (const [networkId, info] of networkInfo) {
        const reserve = status.get(networkId) ?? {
          tokenSymbol: '',
          tokenType: 'NATIVE' as TokenType,
          tokenDecimals: 18,
          nativeTokenSymbol: '',
          totalReserve: 0,
          walletBalance: 0,
          availableForDistribution: 0,
          lastDistribution: null,
          adapterType: 'EVM',
          networkName: info.name
        };
        status.set(networkId, {
          ...reserve,
          name: info.name,
          chainId: info.chainId,
          address: info.address,
          balance: info.balance.toString(),
          gasPrice: info.gasPrice.toString(),
          balanceFormatted: multiNetworkEthereumService.formatEther(info.balance),
          gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice)
        });
      }
    } catch (error) {
      console.error('Failed to get EVM network status:', error);
    }

    for (const [networkId, entryData] of contextEntries.entries()) {
      const { adapter, context } = entryData;
      const entry = status.get(networkId);

      if (!entry) {
        continue;
      }

      const walletBalance = entry.walletBalance ?? 0;
      const balanceString =
        entry.balance ??
        (Number.isFinite(walletBalance) ? walletBalance.toString() : undefined);
      const balanceFormatted =
        entry.balanceFormatted ??
        (Number.isFinite(walletBalance)
          ? adapter.formatAmount(context, walletBalance)
          : undefined);

      let gasPrice = entry.gasPrice;
      let gasPriceFormatted = entry.gasPriceFormatted;
      const needsGasEstimate =
        context.adapterType !== 'EVM' &&
        (!gasPriceFormatted || gasPriceFormatted === 'N/A' || gasPriceFormatted === undefined);

      if (needsGasEstimate) {
        const estimatedGasCost = await this.estimateNetworkGasCost(adapter, context);
        if (estimatedGasCost !== undefined) {
          gasPrice = estimatedGasCost.toString();
          gasPriceFormatted = adapter.formatAmount(context, estimatedGasCost);
        } else {
          gasPrice ??= 'N/A';
          gasPriceFormatted ??= 'N/A';
        }
      }

      status.set(networkId, {
        ...entry,
        name: entry.name ?? context.networkName,
        address: entry.address ?? context.walletAddress,
        balance: balanceString,
        balanceFormatted,
        gasPrice,
        gasPriceFormatted
      });
    }

    for (const [networkId, entry] of status.entries()) {
      const walletBalance = entry.walletBalance ?? 0;
      const decimals = entry.tokenDecimals ?? 0;
      const fallbackBalance = Number.isFinite(walletBalance)
        ? walletBalance.toString()
        : undefined;
      const fallbackFormatted = Number.isFinite(walletBalance)
        ? walletBalance.toLocaleString('en-US', { maximumFractionDigits: decimals })
        : undefined;
      const fallbackGasPrice =
        entry.gasPrice ??
        (entry.gasPriceFormatted && entry.gasPriceFormatted !== 'N/A'
          ? entry.gasPriceFormatted
          : undefined);
      const fallbackGasPriceFormatted =
        entry.gasPriceFormatted ?? (fallbackGasPrice ?? 'N/A');

      status.set(networkId, {
        ...entry,
        name: (entry as unknown as { name?: string }).name ?? entry.networkName ?? networkId,
        chainId: (entry as unknown as { chainId?: number }).chainId ?? undefined,
        address: (entry as unknown as { address?: string }).address ?? entry.address ?? undefined,
        balance: (entry as unknown as { balance?: string }).balance ?? fallbackBalance,
        gasPrice: (entry as unknown as { gasPrice?: string }).gasPrice ?? fallbackGasPrice,
        balanceFormatted:
          (entry as unknown as { balanceFormatted?: string | null }).balanceFormatted ??
          fallbackFormatted,
        gasPriceFormatted:
          (entry as unknown as { gasPriceFormatted?: string }).gasPriceFormatted ??
          fallbackGasPriceFormatted
      });
    }

    return status;
  }

  private async estimateNetworkGasCost(
    adapter: GasTokenNetworkAdapter,
    context: GasTokenNetworkContext
  ): Promise<number | undefined> {
    const baseAmount = Math.max(1 / 10 ** context.tokenDecimals, Number.EPSILON);
    const attemptAmounts = [baseAmount, baseAmount * 10];
    const recipientAddress =
      context.walletAddress ??
      (context.adapterType === 'BITCOIN' ? '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' : undefined);

    if (!recipientAddress) {
      return undefined;
    }

    for (const amountToken of attemptAmounts) {
      try {
        const estimate = await adapter.estimateTransfer(context, recipientAddress, amountToken);
        if (estimate?.gasCostToken !== undefined) {
          return estimate.gasCostToken;
        }
        if (!estimate?.deferReason) {
          break;
        }
        if (!estimate.deferReason.toLowerCase().includes('too small')) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(
          `⚠️  Failed to estimate gas cost for ${context.networkName} (${context.adapterType}): ${message}`
        );
        break;
      }
    }

    return undefined;
  }
}
