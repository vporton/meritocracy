import { PrismaClient } from '@prisma/client';
import { UserEvaluationFlow, UserEvaluationData } from './UserEvaluationFlow.js';
import { TaskManager } from './TaskManager.js';
import { MultiNetworkGasTokenDistributionService, multiNetworkGasTokenDistributionService } from './MultiNetworkGasTokenDistributionService.js';
import { DisconnectedAccountCleanupService } from './DisconnectedAccountCleanupService.js';
import { GlobalDataService } from './GlobalDataService.js';
import { startApiSelfKeepAlive } from './SelfPingKeepAlive.js';

export const cronJobMetadata = {
  quarterlyEvaluation: {
    cron: '0 2 1 */3 *',
    description: '1st day of every 3rd month at 2:00 AM UTC (quarterly active-user review and re-worth assessment)'
  },
  weeklyGasDistribution: {
    cron: '0 20 * * 0',
    description: 'Every Sunday at 20:00 UTC (weekly gas distribution, follows configured biweekly interval)'
  },
  compensationPayout: {
    cron: '0 * * * *',
    description: 'Hourly at minute 0 UTC (compensation payout release)'
  },
  monthlyCleanup: {
    cron: '0 4 1 * *',
    description: '1st of every month at 4:00 AM UTC (disconnected account cleanup)'
  },
  worldGdpRefresh: {
    cron: '0 6 1 * *',
    description: '1st of every month at 06:00 UTC (world GDP refresh)'
  }
} as const;

export class CronExecutionLockedError extends Error {
  constructor(public readonly requestedTask: string, public readonly runningTask: string) {
    super(`Cannot start "${requestedTask}" because "${runningTask}" is already running.`);
    this.name = 'CronExecutionLockedError';
  }
}

export class CronService {
  private prisma: PrismaClient;
  private userEvaluationFlow: UserEvaluationFlow;
  private multiNetworkGasTokenDistributionService: MultiNetworkGasTokenDistributionService;
  private disconnectedAccountCleanupService: DisconnectedAccountCleanupService;
  private readonly distributionIntervalWeeks: 1 | 2;
  private static activeExecution: { token: symbol; taskName: string; startedAt: Date } | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.userEvaluationFlow = new UserEvaluationFlow(prisma);
    this.multiNetworkGasTokenDistributionService = multiNetworkGasTokenDistributionService;
    this.disconnectedAccountCleanupService = new DisconnectedAccountCleanupService(prisma);
    const interval = Number(process.env.GAS_DISTRIBUTION_INTERVAL_WEEKS ?? '1');
    this.distributionIntervalWeeks = interval === 2 ? 2 : 1;
  }

  private runWithExclusiveExecution<T>(taskName: string, operation: () => Promise<T>): Promise<T> {
    const releaseLock = this.acquireExecutionLock(taskName);
    return operation().finally(releaseLock);
  }

  private acquireExecutionLock(taskName: string): () => void {
    const running = CronService.activeExecution;
    if (running) {
      throw new CronExecutionLockedError(taskName, running.taskName);
    }

    const token = Symbol(taskName);
    CronService.activeExecution = {
      token,
      taskName,
      startedAt: new Date()
    };

    return () => {
      if (CronService.activeExecution?.token === token) {
        CronService.activeExecution = null;
      }
    };
  }

  getCronStatus() {
    const activeExecution = CronService.activeExecution;
    const activeTaskName = activeExecution?.taskName ?? null;

    return {
      activeExecution: activeExecution
        ? {
            taskName: activeExecution.taskName,
            startedAt: activeExecution.startedAt.toISOString()
          }
        : null,
      quarterlyEvaluation: {
        running: activeTaskName === 'quarterly evaluation',
        schedule: `${cronJobMetadata.quarterlyEvaluation.cron} (${cronJobMetadata.quarterlyEvaluation.description})`
      },
      weeklyGasDistribution: {
        running: activeTaskName === 'weekly gas distribution',
        schedule: `${cronJobMetadata.weeklyGasDistribution.cron} (${cronJobMetadata.weeklyGasDistribution.description}; interval=${this.distributionIntervalWeeks} week(s))`
      },
      compensationPayout: {
        running: activeTaskName === 'compensation payouts',
        schedule: `${cronJobMetadata.compensationPayout.cron} (${cronJobMetadata.compensationPayout.description})`
      },
      monthlyCleanup: {
        running: activeTaskName === 'monthly cleanup',
        schedule: `${cronJobMetadata.monthlyCleanup.cron} (${cronJobMetadata.monthlyCleanup.description})`
      },
      worldGdpRefresh: {
        running: activeTaskName === 'world GDP refresh',
        schedule: `${cronJobMetadata.worldGdpRefresh.cron} (${cronJobMetadata.worldGdpRefresh.description})`
      }
    };
  }

  async runWeeklyGasDistribution(force: boolean = false) {
    return this.runWithExclusiveExecution('weekly gas distribution', async () => {
      console.log('🔄 Starting multi-network token distribution process...');
      const stopKeepAlive = startApiSelfKeepAlive('weekly gas distribution');

      try {
        if (!force) {
          const isEnabled = await GlobalDataService.isGasDistributionEnabled();
          if (!isEnabled) {
            console.log('🚫 Gas distribution is currently disabled via admin setting.');
            return {
              networkResults: new Map(),
              errors: ['Gas distribution is disabled.']
            };
          }
        }

        if (!force && this.distributionIntervalWeeks === 2 && !this.shouldRunCurrentWeek()) {
          console.log('⏭️  Biweekly mode active: skipping this week regular payout cycle.');
          return {
            networkResults: new Map(),
            errors: [] as string[],
            skippedByBiweeklySchedule: true
          };
        }

        const result = await this.multiNetworkGasTokenDistributionService.processMultiNetworkDistributionTwoStage();
        const execution = await this.multiNetworkGasTokenDistributionService.executePendingTransactions(undefined, 5000);

        console.log('✅ Weekly multi-network token distribution completed');

        for (const [networkName, networkResult] of result.networkResults) {
          console.log(
            `🌐 [${networkName}]: ${networkResult.distributedAmount.toFixed(6)} ${networkResult.tokenSymbol} distributed, ${networkResult.reservedAmount.toFixed(6)} ${networkResult.tokenSymbol} reserved`
          );
        }

        if (result.errors.length > 0) {
          console.log('⚠️  Some errors occurred:');
          result.errors.forEach(error => console.log(`  - ${error}`));
        }

        if (execution.errors.length > 0) {
          console.log('⚠️  Some execution errors occurred:');
          execution.errors.forEach(error => console.log(`  - ${error}`));
        }

        return {
          ...result,
          execution
        };
      } catch (error) {
        console.error('💥 Fatal error in weekly multi-network token distribution process:', error);
        throw error;
      } finally {
        stopKeepAlive();
      }
    });
  }

  async runCompensationPayouts() {
    return this.runWithExclusiveExecution('compensation payouts', async () => {
      console.log('🔄 Running compensation payout flow...');
      const stopKeepAlive = startApiSelfKeepAlive('compensation payouts');

      try {
        const dueUsers = await this.prisma.user.findMany({
          where: {
            compensationDueAt: { lte: new Date() },
            onboarded: true,
            OR: [
              { bannedTill: null },
              { bannedTill: { lt: new Date() } }
            ],
            paymentHoldStartedAt: null
          },
          select: {
            id: true
          }
        });

        if (dueUsers.length === 0) {
          console.log('ℹ️  No due compensation payouts found');
          return {
            dueUsers: 0,
            released: 0,
            skipped: 0,
            errors: [] as string[]
          };
        }

        const userIds = dueUsers.map(u => u.id);
        const release = await this.multiNetworkGasTokenDistributionService.releaseHeldCompensationForUsers(userIds);
        const execution = await this.multiNetworkGasTokenDistributionService.executePendingTransactions(undefined, 5000);

        await this.prisma.user.updateMany({
          where: {
            id: { in: userIds }
          },
          data: {
            compensationDueAt: null
          }
        });

        return {
          dueUsers: dueUsers.length,
          released: release.released,
          skipped: release.skipped,
          releaseErrors: release.errors,
          execution
        };
      } catch (error) {
        console.error('💥 Fatal error in compensation payout flow:', error);
        throw error;
      } finally {
        stopKeepAlive();
      }
    });
  }

  async runMonthlyCleanup() {
    return this.runWithExclusiveExecution('monthly cleanup', async () => {
      console.log('🔄 Starting monthly disconnected account cleanup process...');

      try {
        const result = await this.disconnectedAccountCleanupService.cleanupDisconnectedAccounts(30, false);

        if (result.success) {
          console.log('✅ Monthly disconnected account cleanup completed successfully');
          console.log(`🗑️  Deleted ${result.deletedCount} disconnected accounts`);
          console.log(`🛡️  Preserved ${result.preservedBannedCount} banned accounts`);
          console.log(`🛡️  Preserved ${result.preservedKycCount} KYC accounts`);
          console.log(`📊 Details: ${result.details.disconnectedAccounts} disconnected, ${result.details.bannedAccounts} banned, ${result.details.kycAccounts} with KYC, ${result.details.accountsWithActiveSessions} with active sessions`);

          if (result.errors.length > 0) {
            console.log('⚠️  Some errors occurred:');
            result.errors.forEach(error => console.log(`  - ${error}`));
          }
        } else {
          console.error('❌ Monthly disconnected account cleanup failed');
          result.errors.forEach(error => console.error(`  - ${error}`));
        }

        return result;
      } catch (error) {
        console.error('💥 Fatal error in monthly disconnected account cleanup process:', error);
        throw error;
      }
    });
  }

  async runWorldGdpRefresh() {
    return this.runWithExclusiveExecution('world GDP refresh', async () => {
      console.log('🔄 Checking whether world GDP data needs a refresh...');
      const shouldUpdate = await GlobalDataService.shouldUpdateGdp();
      if (!shouldUpdate) {
        console.log('ℹ️  World GDP is up to date; skipping refresh.');
        return {
          refreshed: false,
          reason: 'not_due'
        };
      }

      console.log('📈 Refreshing world GDP data...');
      const success = await GlobalDataService.fetchAndUpdateWorldGdp();
      if (!success) {
        console.error('❌ World GDP refresh failed');
        return {
          refreshed: false,
          reason: 'failed'
        };
      }

      return {
        refreshed: true
      };
    });
  }

  async runQuarterlyEvaluation(force: boolean = false) {
    return this.runWithExclusiveExecution('quarterly evaluation', async () => {
      console.log('🔄 Starting quarterly evaluation process...');
      const stopKeepAlive = startApiSelfKeepAlive('quarterly evaluation');

      try {
        if (!force && !this.shouldRunCurrentQuarter()) {
          console.log('⏭️  Quarterly evaluation trigger received outside quarter boundary; skipping run.');
          return {
            eligibleUsers: 0,
            successful: 0,
            failed: 0,
            errors: [] as string[],
            skippedByQuarterlySchedule: true,
            salaryStatsUpdated: false
          };
        }

        const eligibleUsers = await this.prisma.user.findMany({
          where: {
            onboarded: true
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

        console.log(`📊 Found ${eligibleUsers.length} eligible users for quarterly evaluation`);

        if (eligibleUsers.length === 0) {
          console.log('ℹ️  No users eligible for quarterly evaluation');
          const salaryStatsUpdated = await GlobalDataService.recomputeAndStoreSalaryStats();
          if (!salaryStatsUpdated) {
            console.warn('⚠️  Failed to recompute and store salary stats after re-worth assessment');
          }
          return {
            eligibleUsers: 0,
            successful: 0,
            failed: 0,
            errors: [] as string[],
            salaryStatsUpdated
          };
        }

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

            const rootTaskId = await this.userEvaluationFlow.createEvaluationFlow(evaluationData);

            console.log(`✅ Created evaluation flow for user ${user.id}, root task ID: ${rootTaskId}`);
            results.successful++;

            const taskManager = new TaskManager(this.prisma);
            await taskManager.runAllPendingTasks();

          } catch (error) {
            const errorMessage = `Failed to create evaluation flow for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            console.error(`❌ ${errorMessage}`);
            results.errors.push(errorMessage);
            results.failed++;
          }
        }

        console.log('📊 Quarterly evaluation process completed:');
        console.log(`  ✅ Successful: ${results.successful}`);
        console.log(`  ❌ Failed: ${results.failed}`);

        if (results.errors.length > 0) {
          console.log('  🚨 Errors:');
          results.errors.forEach(error => console.log(`    - ${error}`));
        }

        const salaryStatsUpdated = await GlobalDataService.recomputeAndStoreSalaryStats();
        if (!salaryStatsUpdated) {
          console.warn('⚠️  Failed to recompute and store salary stats after re-worth assessment');
        }

        return {
          eligibleUsers: eligibleUsers.length,
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
          salaryStatsUpdated
        };

      } catch (error) {
        console.error('💥 Fatal error in quarterly evaluation process:', error);
        throw error;
      } finally {
        stopKeepAlive();
      }
    });
  }

  async runBiMonthlyEvaluation() {
    return this.runQuarterlyEvaluation();
  }

  private shouldRunCurrentQuarter(referenceDate: Date = new Date()): boolean {
    return referenceDate.getUTCMonth() % 3 === 0;
  }

  private shouldRunCurrentWeek(referenceDate: Date = new Date()): boolean {
    const week = this.getIsoWeekNumber(referenceDate);
    return week % 2 === 0;
  }

  private getIsoWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}
