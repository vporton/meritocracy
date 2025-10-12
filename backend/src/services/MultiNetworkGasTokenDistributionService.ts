import { PrismaClient } from '@prisma/client';
import { multiNetworkEthereumService, type TokenTransferRequest } from './MultiNetworkEthereumService.js';
import { GlobalDataService } from './GlobalDataService.js';
import { TokenPriceService, COINGECKO_PLATFORM_BY_NETWORK } from './TokenPriceService.js';
import type { TokenDescriptor, TokenType } from '../types/token.js';

export interface TokenDistributionOptions {
  tokenType: TokenType;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddresses?: Record<string, `0x${string}`>;
  coingeckoId?: string;
  coingeckoPlatformId?: string;
  fallbackPriceUsd?: number;
  nativeFallbackPriceUsd?: number;
  minimumDistributionUsd?: number;
}

interface NetworkTokenContext extends TokenDescriptor {
  networkName: string;
  tokenPriceUsd: number;
  nativeTokenSymbol: string;
  nativeTokenDecimals: number;
  nativeTokenPriceUsd: number;
  minimumDistributionUsd: number;
  coingeckoId?: string;
  coingeckoPlatformId?: string;
}

export interface DistributionFiber {
  userId: number;
  ethereumAddress: string;
  amountToken: number;
  amountUsd: number;
  shareInGDP: number;
}

export interface NetworkDistributionResult {
  tokenSymbol: string;
  tokenType: TokenType;
  tokenDecimals: number;
  tokenPriceUsd: number;
  nativeTokenSymbol: string;
  nativeTokenPriceUsd: number;
  distributedAmount: number;
  distributedUsd: number;
  reservedAmount: number;
  reservedUsd: number;
  distributions: Array<{
    userId: number;
    amount: number;
    amountUsd: number;
    status: 'SENT' | 'DEFERRED' | 'FAILED';
    transactionHash?: string;
    errorMessage?: string;
    gasCostUsd?: number;
  }>;
  errors: string[];
  distributed?: number;
  reserved?: number;
}

export interface MultiNetworkDistributionResult {
  success: boolean;
  totalDistributedUsd: number;
  totalReservedUsd: number;
  networkResults: Map<string, NetworkDistributionResult>;
  errors: string[];
  totalDistributed?: number;
  totalReserved?: number;
}

export class MultiNetworkGasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly GAS_COST_VALUE_MULTIPLIER = 5;
  private readonly DEFAULT_NATIVE_TOKEN_PRICE_USD = 2000;
  private readonly defaultTokenOptions: TokenDistributionOptions;

  constructor(prisma: PrismaClient, defaultTokenOptions?: Partial<TokenDistributionOptions>) {
    this.prisma = prisma;
    this.defaultTokenOptions = {
      tokenType: defaultTokenOptions?.tokenType ?? 'NATIVE',
      tokenSymbol: defaultTokenOptions?.tokenSymbol ?? 'ETH',
      tokenDecimals: defaultTokenOptions?.tokenDecimals ?? 18,
      tokenAddresses: defaultTokenOptions?.tokenAddresses,
      coingeckoId: defaultTokenOptions?.coingeckoId ?? 'ethereum',
      coingeckoPlatformId: defaultTokenOptions?.coingeckoPlatformId,
      fallbackPriceUsd: defaultTokenOptions?.fallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD,
      nativeFallbackPriceUsd: defaultTokenOptions?.nativeFallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD,
      minimumDistributionUsd: defaultTokenOptions?.minimumDistributionUsd
    };
  }

  private resolveTokenOptions(overrides?: Partial<TokenDistributionOptions>): TokenDistributionOptions {
    return {
      tokenType: overrides?.tokenType ?? this.defaultTokenOptions.tokenType,
      tokenSymbol: overrides?.tokenSymbol ?? this.defaultTokenOptions.tokenSymbol,
      tokenDecimals: overrides?.tokenDecimals ?? this.defaultTokenOptions.tokenDecimals,
      tokenAddresses: overrides?.tokenAddresses ?? this.defaultTokenOptions.tokenAddresses,
      coingeckoId: overrides?.coingeckoId ?? this.defaultTokenOptions.coingeckoId,
      coingeckoPlatformId: overrides?.coingeckoPlatformId ?? this.defaultTokenOptions.coingeckoPlatformId,
      fallbackPriceUsd: overrides?.fallbackPriceUsd ?? this.defaultTokenOptions.fallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD,
      nativeFallbackPriceUsd: overrides?.nativeFallbackPriceUsd ?? this.defaultTokenOptions.nativeFallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD,
      minimumDistributionUsd: overrides?.minimumDistributionUsd ?? this.defaultTokenOptions.minimumDistributionUsd
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

    const tokenAddress = tokenOptions.tokenType === 'ERC20'
      ? tokenOptions.tokenAddresses?.[networkName]
      : undefined;

    if (tokenOptions.tokenType === 'ERC20' && !tokenAddress) {
      console.warn(`⚠️  Token address not configured for ${tokenOptions.tokenSymbol} on ${networkName}, skipping`);
      return null;
    }

    const nativeMetadata = multiNetworkEthereumService.getNativeTokenMetadata(networkName);

    const tokenPriceUsd = await TokenPriceService.getTokenPriceUsd({
      tokenType: tokenOptions.tokenType,
      tokenSymbol: tokenOptions.tokenSymbol,
      tokenDecimals: tokenOptions.tokenDecimals,
      tokenAddress,
      coingeckoId: tokenOptions.coingeckoId,
      coingeckoPlatformId: tokenOptions.coingeckoPlatformId ?? COINGECKO_PLATFORM_BY_NETWORK[networkName],
      networkName,
      fallbackPriceUsd: tokenOptions.fallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD
    });

    const nativeTokenPriceUsd = await TokenPriceService.getTokenPriceUsd({
      tokenType: 'NATIVE',
      tokenSymbol: nativeMetadata.symbol,
      tokenDecimals: nativeMetadata.decimals,
      coingeckoId: nativeMetadata.coingeckoId ?? (nativeMetadata.symbol === tokenOptions.tokenSymbol ? tokenOptions.coingeckoId : undefined),
      networkName,
      fallbackPriceUsd: tokenOptions.nativeFallbackPriceUsd ?? this.DEFAULT_NATIVE_TOKEN_PRICE_USD
    });

    return {
      networkName,
      tokenType: tokenOptions.tokenType,
      tokenSymbol: tokenOptions.tokenSymbol,
      tokenDecimals: tokenOptions.tokenDecimals,
      tokenAddress,
      tokenPriceUsd,
      nativeTokenSymbol: nativeMetadata.symbol,
      nativeTokenDecimals: nativeMetadata.decimals,
      nativeTokenPriceUsd,
      minimumDistributionUsd: tokenOptions.minimumDistributionUsd ?? networkConfig.minimumDistributionUsd,
      coingeckoId: tokenOptions.coingeckoId,
      coingeckoPlatformId: tokenOptions.coingeckoPlatformId ?? COINGECKO_PLATFORM_BY_NETWORK[networkName]
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
        tokenAddress: context.tokenAddress,
        tokenDecimals: context.tokenDecimals
      },
      create: { 
        network: context.networkName,
        totalReserve: amount,
        lastDistribution: new Date(),
        tokenType: context.tokenType,
        tokenSymbol: context.tokenSymbol,
        tokenAddress: context.tokenAddress,
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

    // Get current world GDP
    const worldGdp = await GlobalDataService.getWorldGdp();
    if (!worldGdp) {
      throw new Error('World GDP data not available');
    }

    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    const networkDistributions = new Map<string, { context: NetworkTokenContext; distributions: DistributionFiber[] }>();

    // Calculate distributions for each network
    for (const networkName of enabledNetworks) {
      const tokenContext = await this.buildNetworkTokenContext(networkName, tokenOptions);
      if (!tokenContext) {
        continue;
      }

      if (tokenContext.tokenPriceUsd <= 0) {
        console.warn(`⚠️  Token price unavailable or zero for ${tokenContext.tokenSymbol} on ${networkName}, skipping`);
        continue;
      }

      // Get available balance for this network/token
      const walletBalanceRaw = await multiNetworkEthereumService.getTokenBalance(networkName, tokenContext);
      const walletBalance = Number(multiNetworkEthereumService.formatUnits(walletBalanceRaw, tokenContext.tokenDecimals));
      const currentReserve = await this.getTokenReserve(tokenContext);

      let totalAvailable: number;
      if (tokenContext.tokenType === 'NATIVE') {
        const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
        const gasReserve = networkConfig?.gasReserve ?? 0;
        totalAvailable = walletBalance - gasReserve + currentReserve;
      } else {
        totalAvailable = walletBalance + currentReserve;
      }

      if (totalAvailable <= 0) {
        console.log(`⚠️  No ${tokenContext.tokenSymbol} funds available for distribution on ${networkName}`);
        networkDistributions.set(networkName, { context: tokenContext, distributions: [] });
        continue;
      }

      const distributions: DistributionFiber[] = users.map(user => {
        const userGdpShare = user.shareInGDP!;
        const userGdpAmount = (userGdpShare / 100) * worldGdp;
        const amountUsd = userGdpAmount;
        const amountToken = amountUsd / tokenContext.tokenPriceUsd;

        return {
          userId: user.id,
          ethereumAddress: user.ethereumAddress!,
          amountToken,
          amountUsd,
          shareInGDP: userGdpShare
        };
      });
      distributions.sort((a, b) => b.amountUsd - a.amountUsd);

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
      tokenPriceUsd: context.tokenPriceUsd,
      nativeTokenSymbol: context.nativeTokenSymbol,
      nativeTokenPriceUsd: context.nativeTokenPriceUsd,
      distributedAmount: 0,
      distributedUsd: 0,
      reservedAmount: 0,
      reservedUsd: 0,
      distributions: [],
      errors: []
    };

    console.log(`🔄 Processing ${distributions.length} ${context.tokenSymbol} distributions on ${context.networkName}...`);

    for (const dist of distributions) {
      try {
        if (dist.amountUsd < context.minimumDistributionUsd) {
          result.reservedAmount += dist.amountToken;
          result.reservedUsd += dist.amountUsd;

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
              amount: dist.amountToken,
              amountUsd: dist.amountUsd,
              status: 'DEFERRED',
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenAddress: context.tokenAddress,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            amountUsd: dist.amountUsd,
            status: 'DEFERRED'
          });

          console.log(`⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: $${dist.amountUsd.toFixed(2)} (${dist.amountToken.toFixed(6)} ${context.tokenSymbol}) - below $${context.minimumDistributionUsd} threshold`);
          continue;
        }

        let gasCostUsd: number | undefined;
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
          gasCostUsd = gasCostNative * context.nativeTokenPriceUsd;

          if (gasCostUsd !== undefined) {
            const minimumRequiredUsd = gasCostUsd * this.GAS_COST_VALUE_MULTIPLIER;
            if (dist.amountUsd <= minimumRequiredUsd) {
              estimationError = `Transfer value $${dist.amountUsd.toFixed(4)} must exceed $${minimumRequiredUsd.toFixed(4)} to stay ${this.GAS_COST_VALUE_MULTIPLIER}x above the estimated gas cost ($${gasCostUsd.toFixed(4)})`;
              shouldStopDueToGasCost = true;
            }
          }
        } catch (error) {
          estimationError = error instanceof Error ? error.message : 'Failed to estimate gas cost';
          console.warn(`⚠️  [${context.networkName}] Gas estimation failed for user ${dist.userId}: ${estimationError}`);
        }

        if (estimationError) {
          result.reservedAmount += dist.amountToken;
          result.reservedUsd += dist.amountUsd;

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
              amount: dist.amountToken,
              amountUsd: dist.amountUsd,
              status: 'DEFERRED',
              errorMessage: estimationError,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenAddress: context.tokenAddress,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            amountUsd: dist.amountUsd,
            status: 'DEFERRED',
            errorMessage: estimationError,
            gasCostUsd
          });

          console.log(`⏳ [${context.networkName}] Deferred distribution for user ${dist.userId}: ${estimationError}`);
          if (shouldStopDueToGasCost) {
            console.log(`🛑 [${context.networkName}] Halting further distributions because transfer values no longer exceed ${this.GAS_COST_VALUE_MULTIPLIER}x the estimated gas cost.`);
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
              amountUsd: dist.amountUsd,
              status: 'SENT',
              transactionHash,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenAddress: context.tokenAddress,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            amountUsd: dist.amountUsd,
            status: 'SENT',
            transactionHash,
            gasCostUsd
          });

          result.distributedAmount += dist.amountToken;
          result.distributedUsd += dist.amountUsd;

          const gasInfo = gasCostUsd !== undefined ? ` (gas $${gasCostUsd.toFixed(4)})` : '';
          console.log(`✅ [${context.networkName}] Sent ${dist.amountToken.toFixed(6)} ${context.tokenSymbol} ($${dist.amountUsd.toFixed(2)}) to user ${dist.userId}${gasInfo} - TX: ${transactionHash}`);
        } catch (error) {
          result.reservedAmount += dist.amountToken;
          result.reservedUsd += dist.amountUsd;

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: context.networkName,
              amount: dist.amountToken,
              amountUsd: dist.amountUsd,
              status: 'FAILED',
              errorMessage,
              tokenType: context.tokenType,
              tokenSymbol: context.tokenSymbol,
              tokenAddress: context.tokenAddress,
              tokenDecimals: context.tokenDecimals
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountToken,
            amountUsd: dist.amountUsd,
            status: 'FAILED',
            errorMessage,
            gasCostUsd
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

    console.log(`📊 [${context.networkName}] Distribution completed: ${result.distributedAmount.toFixed(6)} ${context.tokenSymbol} distributed ($${result.distributedUsd.toFixed(2)}), ${result.reservedAmount.toFixed(6)} ${context.tokenSymbol} reserved ($${result.reservedUsd.toFixed(2)})`);

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
    console.log(`🔄 Starting multi-network distribution for ${tokenOptions.tokenSymbol} (${tokenOptions.tokenType})...`);

    try {
      const networkDistributions = await this.calculateDistributions(tokenOptions);
      
      if (networkDistributions.size === 0) {
        console.log(`ℹ️  No users eligible for ${tokenOptions.tokenSymbol} distribution`);
        return {
          success: true,
          totalDistributedUsd: 0,
          totalReservedUsd: 0,
          totalDistributed: 0,
          totalReserved: 0,
          networkResults: new Map(),
          errors: []
        };
      }

      const result: MultiNetworkDistributionResult = {
        success: true,
        totalDistributedUsd: 0,
        totalReservedUsd: 0,
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
            result.totalDistributedUsd += networkResult.distributedUsd;
            result.totalReservedUsd += networkResult.reservedUsd;
            
            result.errors.push(...networkResult.errors.map(error => `[${networkName}] ${error}`));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`[${networkName}] Fatal error: ${errorMessage}`);
            console.error(`💥 [${networkName}] Fatal error:`, errorMessage);
          }
        }
      );

      await Promise.all(networkPromises);

      result.totalDistributed = result.totalDistributedUsd;
      result.totalReserved = result.totalReservedUsd;

      console.log(`📊 Multi-network ${tokenOptions.tokenSymbol} distribution completed:`);
      console.log(`  💰 Total distributed: $${result.totalDistributedUsd.toFixed(2)} USD`);
      console.log(`  🏦 Total reserved: $${result.totalReservedUsd.toFixed(2)} USD`);
      
      for (const [networkName, networkResult] of result.networkResults) {
        console.log(`  🌐 [${networkName}]: ${networkResult.distributedAmount.toFixed(6)} ${networkResult.tokenSymbol} distributed ($${networkResult.distributedUsd.toFixed(2)}), ${networkResult.reservedAmount.toFixed(6)} ${networkResult.tokenSymbol} reserved ($${networkResult.reservedUsd.toFixed(2)})`);
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
      console.error(`💥 Fatal error in multi-network ${tokenOptions.tokenSymbol} distribution:`, errorMessage);
      
      return {
        success: false,
        totalDistributedUsd: 0,
        totalReservedUsd: 0,
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
        tokenAddress: context.tokenAddress ?? null,
        tokenPriceUsd: context.tokenPriceUsd,
        nativeTokenSymbol: context.nativeTokenSymbol,
        nativeTokenPriceUsd: context.nativeTokenPriceUsd,
        totalReserve: reserveAmount,
        walletBalance,
        availableForDistribution,
        lastDistribution: reserve?.lastDistribution || null,
        gasReserve,
        minimumDistributionUsd: context.minimumDistributionUsd
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
