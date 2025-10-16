import { PrismaClient } from '@prisma/client';
import { multiNetworkEthereumService } from './MultiNetworkEthereumService.js';
import type { TokenDescriptor, TokenType } from '../types/token.js';

export interface TokenDistributionOptions {
  tokenType?: TokenType;
}

interface NetworkTokenContext extends TokenDescriptor {
  networkName: string;
  nativeTokenSymbol: string;
  nativeTokenDecimals: number;
}

export interface DistributionFiber {
  userId: number;
  ethereumAddress: string;
  amountToken: number;
  shareInGDP: number;
  // Amount accumulated from previous deferred distributions on this network/token
  backlogToken?: number;
}

export interface NetworkDistributionResult {
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

export class MultiNetworkGasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly GAS_COST_VALUE_MULTIPLIER = 5;
  private readonly defaultTokenOptions: TokenDistributionOptions;

  constructor(prisma: PrismaClient, defaultTokenOptions?: TokenDistributionOptions) {
    this.prisma = prisma;
    this.defaultTokenOptions = {
      tokenType: defaultTokenOptions?.tokenType ?? 'NATIVE',
    };
  }

  private resolveTokenOptions(overrides?: TokenDistributionOptions): TokenDistributionOptions {
    return {
      tokenType: overrides?.tokenType ?? this.defaultTokenOptions.tokenType,
    };
  }

  private async buildNetworkTokenContext(
    networkName: string,
    tokenOptions: TokenDistributionOptions
  ): Promise<NetworkTokenContext | null> {
    const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
    if (!networkConfig) {
      console.warn(`⚠️  Network configuration not found for ${networkName}, skipping token distribution`);
      return null;
    }

    if (tokenOptions.tokenType && tokenOptions.tokenType !== 'NATIVE') {
      console.warn(`⚠️  Only native gas token distributions are supported. Skipping ${networkName}.`);
      return null;
    }

    const nativeMetadata = multiNetworkEthereumService.getNativeTokenMetadata(networkName);

    return {
      networkName,
      tokenType: 'NATIVE',
      tokenSymbol: nativeMetadata.symbol,
      tokenDecimals: nativeMetadata.decimals,
      nativeTokenSymbol: nativeMetadata.symbol,
      nativeTokenDecimals: nativeMetadata.decimals,
    };
  }

  private async getTokenReserve(context: NetworkTokenContext): Promise<number> {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: { network_tokenSymbol_tokenType: {
        network: context.networkName,
        tokenSymbol: context.tokenSymbol,
        tokenType: context.tokenType
      } }
    });
    return reserve ? Number(reserve.totalReserve) : 0;
  }

  /**
   * Update the gas token reserve for a specific network
   */
  private async updateGasTokenReserve(context: NetworkTokenContext, amount: number): Promise<void> {
    await this.prisma.gasTokenReserve.upsert({
      where: { network_tokenSymbol_tokenType: {
        network: context.networkName,
        tokenSymbol: context.tokenSymbol,
        tokenType: context.tokenType
      } },
      update: { 
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenDecimals: context.tokenDecimals
      },
      create: { 
        network: context.networkName,
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenType: context.tokenType,
        tokenSymbol: context.tokenSymbol,
        tokenDecimals: context.tokenDecimals
      }
    });
  }

  /**
   * Calculate distribution amounts for all onboarded users based on their GDP share
   * Returns distributions for all enabled networks
   */
  private async calculateDistributions(
    tokenOptions: TokenDistributionOptions
  ): Promise<Map<string, { context: NetworkTokenContext; distributions: DistributionFiber[] }>> {
    // Get all onboarded users with ethereum addresses and GDP shares
    const users = await this.prisma.user.findMany({
      where: {
        onboarded: true,
        ethereumAddress: { not: null },
        shareInGDP: { not: null }
      },
      orderBy: {
        shareInGDP: 'desc'
      },
      select: {
        id: true,
        ethereumAddress: true,
        shareInGDP: true
      }
    });

    if (users.length === 0) {
      return new Map();
    }

    const totalShare = users.reduce((sum, user) => sum + (user.shareInGDP ?? 0), 0); // TODO: inefficient
    if (totalShare <= 0) {
      console.warn('⚠️  Total share in GDP is zero. Skipping distribution.');
      return new Map();
    }

    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    const networkDistributions = new Map<string, { context: NetworkTokenContext; distributions: DistributionFiber[] }>();

    // Calculate distributions for each network
    for (const networkName of enabledNetworks) {
      const tokenContext = await this.buildNetworkTokenContext(networkName, tokenOptions);
      if (!tokenContext) {
        continue;
      }

      // Get available balance for this network/token
      const walletBalanceRaw = await multiNetworkEthereumService.getTokenBalance(networkName, tokenContext);
      const walletBalance = Number(multiNetworkEthereumService.formatUnits(walletBalanceRaw, tokenContext.tokenDecimals));
      const currentReserve = await this.getTokenReserve(tokenContext);

      // Spendable from wallet for the current week (excludes longstanding reserve)
      let spendableFromWallet: number;
      if (tokenContext.tokenType === 'NATIVE') {
        const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
        const gasReserve = networkConfig?.gasReserve ?? 0;
        spendableFromWallet = Math.max(0, walletBalance - gasReserve);
      } else {
        spendableFromWallet = walletBalance;
      }

      // Total we can distribute this run (wallet spendable + previously reserved backlog)
      const totalAvailable = spendableFromWallet + currentReserve;

      if (totalAvailable <= 0) {
        console.log(`⚠️  No ${tokenContext.tokenSymbol} funds available for distribution on ${networkName}`);
        networkDistributions.set(networkName, { context: tokenContext, distributions: [] });
        continue;
      }

      let distributions: DistributionFiber[] = users
        .map(user => {
          const userShare = user.shareInGDP ?? 0;
          const proportion = userShare / totalShare;
          // Weekly earnings portion comes only from current wallet spendable
          const weeklyPortion = proportion > 0 ? spendableFromWallet * proportion : 0;

          return {
            userId: user.id,
            ethereumAddress: user.ethereumAddress!,
            amountToken: weeklyPortion, // temporary; backlog added below
            shareInGDP: userShare
          };
        })
        ;

      // Compute per-user backlog from previously deferred distributions on this network/token
      const deferredRows = await this.prisma.gasTokenDistribution.findMany({
        where: {
          network: tokenContext.networkName,
          tokenSymbol: tokenContext.tokenSymbol,
          tokenType: tokenContext.tokenType,
          status: 'DEFERRED'
        },
        select: {
          userId: true,
          amount: true
        }
      });
      const userIdToBacklog = new Map<number, number>();
      for (const row of deferredRows) {
        const prev = userIdToBacklog.get(row.userId) ?? 0;
        userIdToBacklog.set(row.userId, prev + Number(row.amount));
      }

      // Attach backlog and convert per-user target to (weekly + backlog)
      for (const dist of distributions) {
        dist.backlogToken = userIdToBacklog.get(dist.userId) ?? 0;
        dist.amountToken = dist.amountToken + dist.backlogToken;
      }
      distributions = distributions.filter(dist => dist.amountToken > 0);
      distributions.sort((a, b) => b.amountToken - a.amountToken); // TODO: a heavy operation in memory

      networkDistributions.set(networkName, { context: tokenContext, distributions });
    }

    return networkDistributions;
  }

  /**
   * Process distribution for a single network (async fiber)
   */
  private async processNetworkDistribution(
    context: NetworkTokenContext,
    distributions: DistributionFiber[]
  ): Promise<NetworkDistributionResult> {
    const result: NetworkDistributionResult = {
      tokenSymbol: context.tokenSymbol,
      tokenType: context.tokenType,
      tokenDecimals: context.tokenDecimals,
      distributedAmount: 0,
      reservedAmount: 0,
      distributions: [],
      errors: []
    };

    console.log(`🔄 Processing ${distributions.length} ${context.tokenSymbol} distributions on ${context.networkName}...`);

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
        const amountAsString = dist.amountToken.toLocaleString('en-US', {
          useGrouping: false,
          maximumFractionDigits: context.tokenDecimals
        });

        try {
          const estimate = await multiNetworkEthereumService.estimateTokenTransferCost({
            networkName: context.networkName,
            token: context,
            to: dist.ethereumAddress as `0x${string}`,
            amount: amountAsString
          });

          const gasCostNative = Number(
            multiNetworkEthereumService.formatUnits(estimate.gasCostWei, context.nativeTokenDecimals)
          );
          gasCostToken = gasCostNative;

          if (gasCostToken !== undefined) {
            const minimumRequired = gasCostToken * this.GAS_COST_VALUE_MULTIPLIER;
            if (dist.amountToken <= minimumRequired) {
              estimationError = `Transfer amount ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} must exceed ${minimumRequired.toFixed(6)} ${context.tokenSymbol} to stay ${this.GAS_COST_VALUE_MULTIPLIER}x above the estimated gas cost (${gasCostToken.toFixed(6)} ${context.tokenSymbol})`;
              shouldStopDueToGasCost = true;
            }
          }
        } catch (error) {
          estimationError = error instanceof Error ? error.message : 'Failed to estimate gas cost';
          console.warn(`⚠️  [${context.networkName}] Gas estimation failed for user ${dist.userId}: ${estimationError}`);
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
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

          console.log(`⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`);
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);
          if (shouldStopDueToGasCost) {
            console.log(`🛑 [${context.networkName}] Halting further distributions because transfer amounts no longer exceed ${this.GAS_COST_VALUE_MULTIPLIER}x the estimated gas cost.`);
            break;
          }
          continue;
        }

        try {
          const transactionHash = await multiNetworkEthereumService.sendTokenTransfer({
            networkName: context.networkName,
            token: context,
            to: dist.ethereumAddress as `0x${string}`,
            amount: amountAsString
          });

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
              amount: dist.amountToken,
              amountUsd: 0,
              status: 'SENT',
              transactionHash,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            status: 'SENT',
            transactionHash,
            gasCostToken
          });

          result.distributedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const gasInfo = gasCostToken !== undefined ? ` (gas ${gasCostToken.toFixed(6)} ${context.tokenSymbol})` : '';
          console.log(`✅ [${context.networkName}] Sent ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} to user ${dist.userId}${gasInfo} - TX: ${transactionHash}`);
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          remainingAmount = Math.max(0, remainingAmount - dist.amountToken);

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
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
        console.error(`❌ [${context.networkName}] Error processing user ${dist.userId}: ${errorMessage}`);
      }
    }

    const currentReserve = await this.getTokenReserve(context);
    const newReserve = currentReserve + result.reservedAmount;
    await this.updateGasTokenReserve(context, newReserve);

    console.log(`📊 [${context.networkName}] Distribution completed: ${result.distributedAmount.toFixed(6)} ${context.tokenSymbol} distributed, ${result.reservedAmount.toFixed(6)} ${context.tokenSymbol} reserved`);

    return {
      ...result,
      distributed: result.distributedAmount,
      reserved: result.reservedAmount
    };
  }

  /**
   * Process multi-network gas token distribution using async fibers
   */
  async processMultiNetworkDistribution(
    overrides?: Partial<TokenDistributionOptions>
  ): Promise<MultiNetworkDistributionResult> {
    const tokenOptions = this.resolveTokenOptions(overrides);
    console.log('🔄 Starting multi-network native gas token distribution...');

    try {
      const networkDistributions = await this.calculateDistributions(tokenOptions);
      
      if (networkDistributions.size === 0) {
        console.log('ℹ️  No users eligible for gas token distribution');
        return {
          success: true,
          totalDistributedAmount: 0,
          totalReservedAmount: 0,
          totalDistributed: 0,
          totalReserved: 0,
          networkResults: new Map(),
          errors: []
        };
      }

      const result: MultiNetworkDistributionResult = {
        success: true,
        totalDistributedAmount: 0,
        totalReservedAmount: 0,
        totalDistributed: 0,
        totalReserved: 0,
        networkResults: new Map(),
        errors: []
      };

      const networkPromises = Array.from(networkDistributions.entries()).map(
        async ([networkName, { context, distributions }]) => {
          try {
            const networkResult = await this.processNetworkDistribution(context, distributions);
            result.networkResults.set(networkName, networkResult);
            result.totalDistributedAmount += networkResult.distributedAmount;
            result.totalReservedAmount += networkResult.reservedAmount;
            
            result.errors.push(...networkResult.errors.map(error => `[${networkName}] ${error}`));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`[${networkName}] Fatal error: ${errorMessage}`);
            console.error(`💥 [${networkName}] Fatal error:`, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      result.totalDistributed = result.totalDistributedAmount;
      result.totalReserved = result.totalReservedAmount;

      console.log('📊 Multi-network gas token distribution completed:');
      console.log(`  💰 Total distributed: ${result.totalDistributedAmount.toFixed(6)} tokens`);
      console.log(`  🏦 Total reserved: ${result.totalReservedAmount.toFixed(6)} tokens`);
      
      for (const [networkName, networkResult] of result.networkResults) {
        console.log(`  🌐 [${networkName}]: ${networkResult.distributedAmount.toFixed(6)} ${networkResult.tokenSymbol} distributed, ${networkResult.reservedAmount.toFixed(6)} ${networkResult.tokenSymbol} reserved`);
        console.log(`    ✅ Successful: ${networkResult.distributions.filter(d => d.status === 'SENT').length}`);
        console.log(`    ⏳ Deferred: ${networkResult.distributions.filter(d => d.status === 'DEFERRED').length}`);
        console.log(`    ❌ Failed: ${networkResult.distributions.filter(d => d.status === 'FAILED').length}`);
      }

      if (result.errors.length > 0) {
        console.log('⚠️  Errors occurred:');
        result.errors.forEach(error => console.log(`  - ${error}`));
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

  /**
   * Get distribution history for a user across all networks
   */
  async getUserDistributionHistory(userId: number) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { userId },
      orderBy: { distributionDate: 'desc' }
    });
  }

  /**
   * Get distribution history for a specific network
   */
  async getNetworkDistributionHistory(networkName: string) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { network: networkName },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            ethereumAddress: true
          }
        }
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  /**
   * Get all distribution history
   */
  async getAllDistributionHistory() {
    return await this.prisma.gasTokenDistribution.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            ethereumAddress: true
          }
        }
      },
      orderBy: { distributionDate: 'desc' }
    });
  }

  /**
   * Get current reserve status for all networks
   */
  async getReserveStatus(overrides?: Partial<TokenDistributionOptions>) {
    const tokenOptions = this.resolveTokenOptions(overrides);
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    const reserveStatus = new Map();

    for (const networkName of enabledNetworks) {
      const context = await this.buildNetworkTokenContext(networkName, tokenOptions);
      if (!context) continue;

      const reserve = await this.prisma.gasTokenReserve.findUnique({
        where: { network_tokenSymbol_tokenType: {
          network: context.networkName,
          tokenSymbol: context.tokenSymbol,
          tokenType: context.tokenType
        } }
      });
      const walletBalanceRaw = await multiNetworkEthereumService.getTokenBalance(networkName, context);
      const walletBalance = Number(multiNetworkEthereumService.formatUnits(walletBalanceRaw, context.tokenDecimals));
      const reserveAmount = reserve ? Number(reserve.totalReserve) : 0;
      const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
      const gasReserve = context.tokenType === 'NATIVE' ? (networkConfig?.gasReserve || 0) : 0;
      const availableForDistribution = context.tokenType === 'NATIVE'
        ? walletBalance - gasReserve + reserveAmount
        : walletBalance + reserveAmount;
      
      reserveStatus.set(networkName, {
        tokenSymbol: context.tokenSymbol,
        tokenType: context.tokenType,
        tokenDecimals: context.tokenDecimals,
        nativeTokenSymbol: context.nativeTokenSymbol,
        totalReserve: reserveAmount,
        walletBalance,
        availableForDistribution,
        lastDistribution: reserve?.lastDistribution || null,
        gasReserve,
      });
    }

    return reserveStatus;
  }

  /**
   * Get network status for all enabled networks
   */
  async getNetworkStatus(overrides?: Partial<TokenDistributionOptions>) {
    try {
      const networkInfo = await multiNetworkEthereumService.getAllNetworkInfo();
      const reserveStatus = await this.getReserveStatus(overrides);
      
      const status = new Map();
      for (const [networkName, info] of networkInfo) {
        const reserve = reserveStatus.get(networkName);
        status.set(networkName, {
          name: info.name,
          chainId: info.chainId,
          address: info.address,
          balance: info.balance.toString(), // Convert BigInt to string
          gasPrice: info.gasPrice.toString(), // Convert BigInt to string
          balanceFormatted: multiNetworkEthereumService.formatEther(info.balance),
          gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice),
          ...reserve
        });
      }
      
      return status;
    } catch (error) {
      console.error('Failed to get network status:', error);
      return new Map();
    }
  }
}
