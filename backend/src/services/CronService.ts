import { PrismaClient } from '@prisma/client';
import * as cron from 'node-cron';
import { UserEvaluationFlow, UserEvaluationData } from './UserEvaluationFlow.js';
import { TaskManager } from './TaskManager.js';
import { GasTokenDistributionService } from './GasTokenDistributionService.js';
import { MultiNetworkGasTokenDistributionService } from './MultiNetworkGasTokenDistributionService.js';

export class CronService {
  private prisma: PrismaClient;
  private userEvaluationFlow: UserEvaluationFlow;
  private gasTokenDistributionService: GasTokenDistributionService;
  private multiNetworkGasTokenDistributionService: MultiNetworkGasTokenDistributionService;
  private cronJob: cron.ScheduledTask | null = null;
  private weeklyGasDistributionJob: cron.ScheduledTask | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.userEvaluationFlow = new UserEvaluationFlow(prisma);
    this.gasTokenDistributionService = new GasTokenDistributionService(prisma);
    this.multiNetworkGasTokenDistributionService = new MultiNetworkGasTokenDistributionService(prisma);
  }

  /**
   * Start the bi-monthly cron job for user evaluation flows
   * Runs on the 1st of every other month at 2:00 AM UTC
   */
  startBiMonthlyEvaluationCron() {
    if (this.cronJob) {
      console.log('⚠️  Bi-monthly evaluation cron job is already running');
      return;
    }

    // Cron expression: "0 2 1 */2 *" means:
    // - 0 minutes
    // - 2 hours (2 AM)
    // - 1st day of month
    // - Every 2nd month (January, March, May, July, September, November)
    // - Every day of week
    this.cronJob = cron.schedule('0 2 1 */2 *', async () => {
      console.log('🕐 Bi-monthly evaluation cron job triggered');
      await this.runBiMonthlyEvaluation();
    }, {
      timezone: 'UTC'
    });

    this.cronJob.start();
    console.log('✅ Bi-monthly evaluation cron job started (runs on 1st of every other month at 2:00 AM UTC)');
  }

  /**
   * Stop the bi-monthly cron job
   */
  stopBiMonthlyEvaluationCron() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('⏹️  Bi-monthly evaluation cron job stopped');
    }
  }

  /**
   * Start the weekly cron job for gas token distribution
   * Runs every Sunday at 3:00 AM UTC
   */
  startWeeklyGasDistributionCron() {
    if (this.weeklyGasDistributionJob) {
      console.log('⚠️  Weekly gas distribution cron job is already running');
      return;
    }

    // Cron expression: "0 3 * * 0" means:
    // - 0 minutes
    // - 3 hours (3 AM)
    // - Every day of month
    // - Every month
    // - 0 = Sunday
    this.weeklyGasDistributionJob = cron.schedule('0 3 * * 0', async () => {
      console.log('🕐 Weekly gas token distribution cron job triggered');
      await this.runWeeklyGasDistribution();
    }, {
      timezone: 'UTC'
    });

    this.weeklyGasDistributionJob.start();
    console.log('✅ Weekly gas distribution cron job started (runs every Sunday at 3:00 AM UTC)');
  }

  /**
   * Stop the weekly gas distribution cron job
   */
  stopWeeklyGasDistributionCron() {
    if (this.weeklyGasDistributionJob) {
      this.weeklyGasDistributionJob.stop();
      this.weeklyGasDistributionJob = null;
      console.log('⏹️  Weekly gas distribution cron job stopped');
    }
  }

  /**
   * Manually trigger the weekly gas token distribution process
   * This can be called via API endpoint for testing
   */
  async runWeeklyGasDistribution() {
    console.log('🔄 Starting weekly multi-network gas token distribution process...');
    
    try {
      const result = await this.multiNetworkGasTokenDistributionService.processMultiNetworkDistribution();
      
      if (result.success) {
        console.log('✅ Weekly multi-network gas token distribution completed successfully');
        console.log(`💰 Total distributed: ${result.totalDistributed.toFixed(6)} ETH`);
        console.log(`🏦 Total reserved: ${result.totalReserved.toFixed(6)} ETH`);
        
        // Log per-network results
        for (const [networkName, networkResult] of result.networkResults) {
          console.log(`🌐 [${networkName}]: ${networkResult.distributed.toFixed(6)} ETH distributed, ${networkResult.reserved.toFixed(6)} ETH reserved`);
        }
        
        if (result.errors.length > 0) {
          console.log('⚠️  Some errors occurred:');
          result.errors.forEach(error => console.log(`  - ${error}`));
        }
      } else {
        console.error('❌ Weekly multi-network gas token distribution failed');
        result.errors.forEach(error => console.error(`  - ${error}`));
      }

      return result;
    } catch (error) {
      console.error('💥 Fatal error in weekly multi-network gas token distribution process:', error);
      throw error;
    }
  }

  /**
   * Manually trigger the bi-monthly evaluation process
   * This can be called via API endpoint for testing
   */
  async runBiMonthlyEvaluation() {
    console.log('🔄 Starting bi-monthly evaluation process...');
    
    try {
      // Find onboarded users who were updated more than a month ago
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const eligibleUsers = await this.prisma.user.findMany({
        where: {
          onboarded: true,
          updatedAt: {
            lt: oneMonthAgo
          }
        },
        select: {
          id: true,
          orcidId: true,
          githubHandle: true,
          bitbucketHandle: true,
          gitlabHandle: true,
          name: true,
          email: true
        }
      });

      console.log(`📊 Found ${eligibleUsers.length} eligible users for evaluation`);

      if (eligibleUsers.length === 0) {
        console.log('ℹ️  No users eligible for bi-monthly evaluation');
        return;
      }

      // Process each eligible user
      const results = {
        successful: 0,
        failed: 0,
        errors: [] as string[]
      };

      for (const user of eligibleUsers) {
        try {
          console.log(`🔄 Creating evaluation flow for user ${user.id} (${user.name || user.email || 'Unknown'})`);
          
          const evaluationData: UserEvaluationData = {
            userId: user.id,
            userData: {
              orcidId: user.orcidId || undefined,
              githubHandle: user.githubHandle || undefined,
              bitbucketHandle: user.bitbucketHandle || undefined,
              gitlabHandle: user.gitlabHandle || undefined,
              name: user.name || undefined,
              email: user.email || undefined
            }
          };

          // Create evaluation flow (without scientist onboarding since user is already onboarded)
          const rootTaskId = await this.userEvaluationFlow.createEvaluationFlow(evaluationData);
          
          console.log(`✅ Created evaluation flow for user ${user.id}, root task ID: ${rootTaskId}`);
          results.successful++;

          const taskManager = new TaskManager(this.prisma);
          const success = await taskManager.runAllPendingTasks();
      
        } catch (error) {
          const errorMessage = `Failed to create evaluation flow for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(`❌ ${errorMessage}`);
          results.errors.push(errorMessage);
          results.failed++;
        }
      }

      console.log('📊 Bi-monthly evaluation process completed:');
      console.log(`  ✅ Successful: ${results.successful}`);
      console.log(`  ❌ Failed: ${results.failed}`);
      
      if (results.errors.length > 0) {
        console.log('  🚨 Errors:');
        results.errors.forEach(error => console.log(`    - ${error}`));
      }

    } catch (error) {
      console.error('💥 Fatal error in bi-monthly evaluation process:', error);
      throw error;
    }
  }

  /**
   * Get the status of the cron jobs
   */
  getCronStatus() {
    return {
      biMonthlyEvaluation: {
        isRunning: this.cronJob !== null,
        nextRun: this.cronJob ? this.getNextRunTime() : null,
        schedule: '0 2 1 */2 * (1st of every other month at 2:00 AM UTC)'
      },
      weeklyGasDistribution: {
        isRunning: this.weeklyGasDistributionJob !== null,
        nextRun: this.weeklyGasDistributionJob ? this.getNextWeeklyRunTime() : null,
        schedule: '0 3 * * 0 (Every Sunday at 3:00 AM UTC)'
      }
    };
  }

  /**
   * Get the next run time for the bi-monthly evaluation cron job
   */
  private getNextRunTime(): Date | null {
    if (!this.cronJob) return null;
    
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Bi-monthly runs on odd months (0, 2, 4, 6, 8, 10) - January, March, May, July, September, November
    const isOddMonth = currentMonth % 2 === 0;
    
    // Check if we're before the 1st of this month and this is an odd month
    if (currentDay < 1 && isOddMonth) {
      return new Date(currentYear, currentMonth, 1, 2, 0, 0);
    }
    
    // Find the next odd month
    let nextMonth = currentMonth;
    let nextYear = currentYear;
    
    // If current month is odd and we're past the 1st, or if current month is even
    if ((isOddMonth && currentDay >= 1) || !isOddMonth) {
      // Move to next odd month
      nextMonth = currentMonth + 1;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear = currentYear + 1;
      }
      
      // If next month is even, move to the one after that
      if (nextMonth % 2 === 1) {
        nextMonth = nextMonth + 1;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear = nextYear + 1;
        }
      }
    }
    
    return new Date(nextYear, nextMonth, 1, 2, 0, 0);
  }

  /**
   * Get the next run time for the weekly gas distribution cron job
   */
  private getNextWeeklyRunTime(): Date | null {
    if (!this.weeklyGasDistributionJob) return null;
    
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Calculate days until next Sunday
    const daysUntilSunday = currentDay === 0 ? 7 : (7 - currentDay);
    
    // If it's Sunday and before 3 AM, next run is today at 3 AM
    if (currentDay === 0 && (currentHour < 3 || (currentHour === 3 && currentMinute === 0))) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0);
    }
    
    // Otherwise, next run is next Sunday at 3 AM
    const nextRun = new Date(now);
    nextRun.setDate(now.getDate() + daysUntilSunday);
    nextRun.setHours(3, 0, 0, 0);
    
    return nextRun;
  }

  /**
   * Cleanup method to stop cron jobs when the service is destroyed
   */
  destroy() {
    this.stopBiMonthlyEvaluationCron();
    this.stopWeeklyGasDistributionCron();
  }
}
