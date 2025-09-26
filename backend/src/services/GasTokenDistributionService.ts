import { PrismaClient } from '@prisma/client';
import { ethereumService } from './ethereum.js';
import { GlobalDataService } from './GlobalDataService.js';

export interface GasTokenDistributionResult {
  success: boolean;
  totalDistributed: number;
  totalReserved: number;
  distributions: Array<{
    userId: number;
    amount: number;
    amountUsd: number;
    status: 'SENT' | 'DEFERRED' | 'FAILED';
    transactionHash?: string;
    errorMessage?: string;
  }>;
  errors: string[];
}

export class GasTokenDistributionService {
  private prisma: PrismaClient;
  private readonly MINIMUM_DISTRIBUTION_USD = 20; // $20 minimum threshold
  private readonly GAS_RESERVE_ETH = 0.01; // Keep 0.01 ETH for gas fees

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
    return 2000; // $2000 per ETH
  }

  /**
   * Get the current gas token reserve
   */
  private async getGasTokenReserve(): Promise<number> {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: { network: 'mainnet' } // Default to mainnet for backward compatibility
    });
    return reserve ? Number(reserve.totalReserve) : 0;
  }

  /**
   * Update the gas token reserve
   */
  private async updateGasTokenReserve(amount: number): Promise<void> {
    await this.prisma.gasTokenReserve.upsert({
      where: { network: 'mainnet' }, // Default to mainnet for backward compatibility
      update: { 
        totalReserve: amount,
        lastDistribution: new Date()
      },
      create: { 
        network: 'mainnet', // Default to mainnet for backward compatibility
        totalReserve: amount,
        lastDistribution: new Date()
      }
    });
  }

  /**
   * Get the current wallet balance in ETH
   */
  private async getWalletBalance(): Promise<number> {
    const balance = await ethereumService.getBalance();
    return Number(ethereumService.formatEther(balance));
  }

  /**
   * Calculate distribution amounts for all onboarded users based on their GDP share
   */
  private async calculateDistributions(): Promise<Array<{
    userId: number;
    ethereumAddress: string;
    shareInGDP: number;
    amountEth: number;
    amountUsd: number;
  }>> {
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
      return [];
    }

    // Get current world GDP
    const worldGdp = await GlobalDataService.getWorldGdp();
    if (!worldGdp) {
      throw new Error('World GDP data not available');
    }

    // Get current ETH price
    const ethPriceUsd = await this.getEthPriceUsd();

    // Calculate total available for distribution
    const walletBalance = await this.getWalletBalance();
    const currentReserve = await this.getGasTokenReserve();
    const totalAvailable = walletBalance - this.GAS_RESERVE_ETH + currentReserve;

    // Calculate distributions
    const distributions = users.map(user => {
      const userGdpShare = user.shareInGDP!;
      const userGdpAmount = (userGdpShare / 100) * worldGdp; // Convert percentage to actual amount
      const amountUsd = userGdpAmount;
      const amountEth = amountUsd / ethPriceUsd;

      return {
        userId: user.id,
        ethereumAddress: user.ethereumAddress!,
        shareInGDP: userGdpShare,
        amountEth,
        amountUsd
      };
    });

    return distributions;
  }

  /**
   * Send ETH to a user's ethereum address
   */
  private async sendEthToUser(ethereumAddress: string, amountEth: number): Promise<string> {
    const tx = await ethereumService.sendTransaction(ethereumAddress as `0x${string}`, amountEth.toString());
    return tx;
  }

  /**
   * Process weekly gas token distribution
   */
  async processWeeklyDistribution(): Promise<GasTokenDistributionResult> {
    console.log('🔄 Starting weekly gas token distribution...');

    try {
      // Calculate distributions
      const distributions = await this.calculateDistributions();
      
      if (distributions.length === 0) {
        console.log('ℹ️  No users eligible for gas token distribution');
        return {
          success: true,
          totalDistributed: 0,
          totalReserved: 0,
          distributions: [],
          errors: []
        };
      }

      const ethPriceUsd = await this.getEthPriceUsd();
      const result: GasTokenDistributionResult = {
        success: true,
        totalDistributed: 0,
        totalReserved: 0,
        distributions: [],
        errors: []
      };

      let totalReserved = 0;

      // Process each distribution
      for (const dist of distributions) {
        try {
          if (dist.amountUsd < this.MINIMUM_DISTRIBUTION_USD) {
            // Amount too small, add to reserve
            totalReserved += dist.amountEth;
            
            // Record as deferred
            await this.prisma.gasTokenDistribution.create({
              data: {
                userId: dist.userId,
                network: 'mainnet', // Default to mainnet for backward compatibility
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

            console.log(`⏳ Deferred distribution for user ${dist.userId}: $${dist.amountUsd.toFixed(2)} (${dist.amountEth.toFixed(6)} ETH) - below $${this.MINIMUM_DISTRIBUTION_USD} threshold`);
          } else {
            // Amount is sufficient, send immediately
            try {
              const transactionHash = await this.sendEthToUser(dist.ethereumAddress, dist.amountEth);
              
              // Record as sent
              await this.prisma.gasTokenDistribution.create({
                data: {
                  userId: dist.userId,
                  network: 'mainnet', // Default to mainnet for backward compatibility
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

              result.totalDistributed += dist.amountEth;
              console.log(`✅ Sent ${dist.amountEth.toFixed(6)} ETH ($${dist.amountUsd.toFixed(2)}) to user ${dist.userId} - TX: ${transactionHash}`);
            } catch (error) {
              // Send failed, add to reserve
              totalReserved += dist.amountEth;
              
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              
              // Record as failed
              await this.prisma.gasTokenDistribution.create({
                data: {
                  userId: dist.userId,
                  network: 'mainnet', // Default to mainnet for backward compatibility
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
              console.error(`❌ Failed to send to user ${dist.userId}: ${errorMessage}`);
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Error processing user ${dist.userId}: ${errorMessage}`);
          console.error(`❌ Error processing user ${dist.userId}: ${errorMessage}`);
        }
      }

      // Update reserve with accumulated amounts
      const currentReserve = await this.getGasTokenReserve();
      const newReserve = currentReserve + totalReserved;
      await this.updateGasTokenReserve(newReserve);
      result.totalReserved = newReserve;

      console.log('📊 Weekly gas token distribution completed:');
      console.log(`  💰 Total distributed: ${result.totalDistributed.toFixed(6)} ETH`);
      console.log(`  🏦 Total reserved: ${result.totalReserved.toFixed(6)} ETH`);
      console.log(`  ✅ Successful: ${result.distributions.filter(d => d.status === 'SENT').length}`);
      console.log(`  ⏳ Deferred: ${result.distributions.filter(d => d.status === 'DEFERRED').length}`);
      console.log(`  ❌ Failed: ${result.distributions.filter(d => d.status === 'FAILED').length}`);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('💥 Fatal error in weekly gas token distribution:', errorMessage);
      
      return {
        success: false,
        totalDistributed: 0,
        totalReserved: 0,
        distributions: [],
        errors: [errorMessage]
      };
    }
  }

  /**
   * Get distribution history for a user
   */
  async getUserDistributionHistory(userId: number) {
    return await this.prisma.gasTokenDistribution.findMany({
      where: { userId },
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
   * Get current reserve status
   */
  async getReserveStatus() {
    const reserve = await this.prisma.gasTokenReserve.findUnique({
      where: { network: 'mainnet' } // Default to mainnet for backward compatibility
    });
    const walletBalance = await this.getWalletBalance();
    
    return {
      totalReserve: reserve ? Number(reserve.totalReserve) : 0,
      walletBalance,
      availableForDistribution: walletBalance - this.GAS_RESERVE_ETH + (reserve ? Number(reserve.totalReserve) : 0),
      lastDistribution: reserve?.lastDistribution || null
    };
  }
}
