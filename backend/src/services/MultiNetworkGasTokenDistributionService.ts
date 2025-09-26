import { PrismaClient } from '@prisma/client';
import { multiNetworkEthereumService, NetworkConfig } from './MultiNetworkEthereumService.js';
import { GlobalDataService } from './GlobalDataService.js';

export interface MultiNetworkDistributionResult {
  success: boolean;
  totalDistributed: number;
  totalReserved: number;
  networkResults: Map<string, {
    distributed: number;
    reserved: number;
    distributions: Array<{
      userId: number;
      amount: number;
      amountUsd: number;
      status: 'SENT' | 'DEFERRED' | 'FAILED';
      transactionHash?: string;
      errorMessage?: string;
    }>;
    errors: string[];
  }>;
  errors: string[];
}

export interface DistributionFiber {
  networkName: string;
  userId: number;
  ethereumAddress: string;
  amountEth: number;
  amountUsd: number;
  shareInGDP: number;
}

export class MultiNetworkGasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly DEFAULT_ETH_PRICE_USD = 2000; // Placeholder ETH price

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get current ETH price in USD
   * This is a placeholder - in production, you'd fetch from a real API
   */
  private async getEthPriceUsd(): Promise<number> {
    // TODO: Implement real ETH price fetching from CoinGecko, CoinMarketCap, etc.
    // For now, return a placeholder value
    return this.DEFAULT_ETH_PRICE_USD;
  }

  /**
   * Get the current gas token reserve for a specific network
   */
  private async getGasTokenReserve(networkName: string): Promise<number> {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: { network: networkName }
    });
    return reserve ? Number(reserve.totalReserve) : 0;
  }

  /**
   * Update the gas token reserve for a specific network
   */
  private async updateGasTokenReserve(networkName: string, amount: number): Promise<void> {
    await this.prisma.gasTokenReserve.upsert({
      where: { network: networkName },
      update: { 
        totalReserve: amount,
        lastDistribution: new Date()
      },
      create: { 
        network: networkName,
        totalReserve: amount,
        lastDistribution: new Date()
      }
    });
  }

  /**
   * Get the current wallet balance in ETH for a specific network
   */
  private async getWalletBalance(networkName: string): Promise<number> {
    const balance = await multiNetworkEthereumService.getBalance(networkName);
    return Number(multiNetworkEthereumService.formatEther(balance));
  }

  /**
   * Calculate distribution amounts for all onboarded users based on their GDP share
   * Returns distributions for all enabled networks
   */
  private async calculateDistributions(): Promise<Map<string, DistributionFiber[]>> {
    // Get all onboarded users with ethereum addresses and GDP shares
    const users = await this.prisma.user.findMany({
      where: {
        onboarded: true,
        ethereumAddress: { not: null },
        shareInGDP: { not: null }
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

    // Get current ETH price
    const ethPriceUsd = await this.getEthPriceUsd();

    // Get enabled networks
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    const networkDistributions = new Map<string, DistributionFiber[]>();

    // Calculate distributions for each network
    for (const networkName of enabledNetworks) {
      const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
      if (!networkConfig) continue;

      // Get available balance for this network
      const walletBalance = await this.getWalletBalance(networkName);
      const currentReserve = await this.getGasTokenReserve(networkName);
      const totalAvailable = walletBalance - networkConfig.gasReserve + currentReserve;

      if (totalAvailable <= 0) {
        console.log(`⚠️  No funds available for distribution on ${networkName}`);
        networkDistributions.set(networkName, []);
        continue;
      }

      // Calculate distributions for this network
      const distributions: DistributionFiber[] = users.map(user => {
        const userGdpShare = user.shareInGDP!;
        const userGdpAmount = (userGdpShare / 100) * worldGdp;
        const amountUsd = userGdpAmount;
        const amountEth = amountUsd / ethPriceUsd;

        return {
          networkName,
          userId: user.id,
          ethereumAddress: user.ethereumAddress!,
          amountEth,
          amountUsd,
          shareInGDP: userGdpShare
        };
      });

      networkDistributions.set(networkName, distributions);
    }

    return networkDistributions;
  }

  /**
   * Process distribution for a single network (async fiber)
   */
  private async processNetworkDistribution(
    networkName: string, 
    distributions: DistributionFiber[]
  ): Promise<{
    distributed: number;
    reserved: number;
    distributions: Array<{
      userId: number;
      amount: number;
      amountUsd: number;
      status: 'SENT' | 'DEFERRED' | 'FAILED';
      transactionHash?: string;
      errorMessage?: string;
    }>;
    errors: string[];
  }> {
    const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
    if (!networkConfig) {
      throw new Error(`Network configuration not found for ${networkName}`);
    }

    const result = {
      distributed: 0,
      reserved: 0,
      distributions: [] as Array<{
        userId: number;
        amount: number;
        amountUsd: number;
        status: 'SENT' | 'DEFERRED' | 'FAILED';
        transactionHash?: string;
        errorMessage?: string;
      }>,
      errors: [] as string[]
    };

    console.log(`🔄 Processing ${distributions.length} distributions on ${networkName}...`);

    // Process each distribution for this network
    for (const dist of distributions) {
      try {
        if (dist.amountUsd < networkConfig.minimumDistributionUsd) {
          // Amount too small, add to reserve
          result.reserved += dist.amountEth;
          
          // Record as deferred
          await this.prisma.gasTokenDistribution.create({
            data: {
              userId: dist.userId,
              network: networkName,
              amount: dist.amountEth,
              amountUsd: dist.amountUsd,
              status: 'DEFERRED'
            }
          });

          result.distributions.push({
            userId: dist.userId,
            amount: dist.amountEth,
            amountUsd: dist.amountUsd,
            status: 'DEFERRED'
          });

          console.log(`⏳ [${networkName}] Deferred distribution for user ${dist.userId}: $${dist.amountUsd.toFixed(2)} (${dist.amountEth.toFixed(6)} ETH) - below $${networkConfig.minimumDistributionUsd} threshold`);
        } else {
          // Amount is sufficient, send immediately
          try {
            const transactionHash = await multiNetworkEthereumService.sendTransaction(
              networkName,
              dist.ethereumAddress as `0x${string}`,
              dist.amountEth.toString()
            );
            
            // Record as sent
            await this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: networkName,
                amount: dist.amountEth,
                amountUsd: dist.amountUsd,
                status: 'SENT',
                transactionHash
              }
            });

            result.distributions.push({
              userId: dist.userId,
              amount: dist.amountEth,
              amountUsd: dist.amountUsd,
              status: 'SENT',
              transactionHash
            });

            result.distributed += dist.amountEth;
            console.log(`✅ [${networkName}] Sent ${dist.amountEth.toFixed(6)} ETH ($${dist.amountUsd.toFixed(2)}) to user ${dist.userId} - TX: ${transactionHash}`);
          } catch (error) {
            // Send failed, add to reserve
            result.reserved += dist.amountEth;
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Record as failed
            await this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: networkName,
                amount: dist.amountEth,
                amountUsd: dist.amountUsd,
                status: 'FAILED',
                errorMessage
              }
            });

            result.distributions.push({
              userId: dist.userId,
              amount: dist.amountEth,
              amountUsd: dist.amountUsd,
              status: 'FAILED',
              errorMessage
            });

            result.errors.push(`Failed to send to user ${dist.userId}: ${errorMessage}`);
            console.error(`❌ [${networkName}] Failed to send to user ${dist.userId}: ${errorMessage}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
        console.error(`❌ [${networkName}] Error processing user ${dist.userId}: ${errorMessage}`);
      }
    }

    // Update reserve for this network
    const currentReserve = await this.getGasTokenReserve(networkName);
    const newReserve = currentReserve + result.reserved;
    await this.updateGasTokenReserve(networkName, newReserve);

    console.log(`📊 [${networkName}] Distribution completed: ${result.distributed.toFixed(6)} ETH distributed, ${result.reserved.toFixed(6)} ETH reserved`);
    return result;
  }

  /**
   * Process multi-network gas token distribution using async fibers
   */
  async processMultiNetworkDistribution(): Promise<MultiNetworkDistributionResult> {
    console.log('🔄 Starting multi-network gas token distribution...');

    try {
      // Calculate distributions for all networks
      const networkDistributions = await this.calculateDistributions();
      
      if (networkDistributions.size === 0) {
        console.log('ℹ️  No users eligible for gas token distribution');
        return {
          success: true,
          totalDistributed: 0,
          totalReserved: 0,
          networkResults: new Map(),
          errors: []
        };
      }

      const result: MultiNetworkDistributionResult = {
        success: true,
        totalDistributed: 0,
        totalReserved: 0,
        networkResults: new Map(),
        errors: []
      };

      // Create async fibers for each network
      const networkPromises = Array.from(networkDistributions.entries()).map(
        async ([networkName, distributions]) => {
          try {
            const networkResult = await this.processNetworkDistribution(networkName, distributions);
            result.networkResults.set(networkName, networkResult);
            result.totalDistributed += networkResult.distributed;
            result.totalReserved += networkResult.reserved;
            
            // Collect errors
            result.errors.push(...networkResult.errors.map(error => `[${networkName}] ${error}`));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`[${networkName}] Fatal error: ${errorMessage}`);
            console.error(`💥 [${networkName}] Fatal error:`, errorMessage);
          }
        }
      );

      // Wait for all network distributions to complete
      await Promise.all(networkPromises);

      console.log('📊 Multi-network gas token distribution completed:');
      console.log(`  💰 Total distributed: ${result.totalDistributed.toFixed(6)} ETH`);
      console.log(`  🏦 Total reserved: ${result.totalReserved.toFixed(6)} ETH`);
      
      for (const [networkName, networkResult] of result.networkResults) {
        console.log(`  🌐 [${networkName}]: ${networkResult.distributed.toFixed(6)} ETH distributed, ${networkResult.reserved.toFixed(6)} ETH reserved`);
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
  async getReserveStatus() {
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    const reserveStatus = new Map();

    for (const networkName of enabledNetworks) {
      const reserve = await this.prisma.gasTokenReserve.findUnique({
        where: { network: networkName }
      });
      const walletBalance = await this.getWalletBalance(networkName);
      const networkConfig = multiNetworkEthereumService.getNetworkConfig(networkName);
      
      reserveStatus.set(networkName, {
        totalReserve: reserve ? Number(reserve.totalReserve) : 0,
        walletBalance,
        availableForDistribution: walletBalance - (networkConfig?.gasReserve || 0) + (reserve ? Number(reserve.totalReserve) : 0),
        lastDistribution: reserve?.lastDistribution || null,
        gasReserve: networkConfig?.gasReserve || 0,
        minimumDistributionUsd: networkConfig?.minimumDistributionUsd || 20
      });
    }

    return reserveStatus;
  }

  /**
   * Get network status for all enabled networks
   */
  async getNetworkStatus() {
    try {
      const networkInfo = await multiNetworkEthereumService.getAllNetworkInfo();
      const reserveStatus = await this.getReserveStatus();
      
      const status = new Map();
      for (const [networkName, info] of networkInfo) {
        const reserve = reserveStatus.get(networkName);
        status.set(networkName, {
          ...info,
          ...reserve,
          balanceFormatted: multiNetworkEthereumService.formatEther(info.balance),
          gasPriceFormatted: multiNetworkEthereumService.formatEther(info.gasPrice)
        });
      }
      
      return status;
    } catch (error) {
      console.error('Failed to get network status:', error);
      return new Map();
    }
  }
}
