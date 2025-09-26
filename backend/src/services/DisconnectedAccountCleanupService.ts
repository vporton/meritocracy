import { PrismaClient } from '@prisma/client';

export interface CleanupResult {
  success: boolean;
  deletedCount: number;
  preservedBannedCount: number;
  preservedKycCount: number;
  errors: string[];
  details: {
    disconnectedAccounts: number;
    bannedAccounts: number;
    kycAccounts: number;
    accountsWithActiveSessions: number;
  };
}

export class DisconnectedAccountCleanupService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Clean up disconnected accounts while preserving banned accounts and KYC data
   * 
   * A disconnected account is defined as:
   * - No active sessions (all sessions expired)
   * - Never been banned (bannedTill is null - never had a ban)
   * - No KYC data (kycStatus is null - never had KYC verification)
   * - Account created more than 30 days ago (grace period for new accounts)
   * 
   * SECURITY NOTES:
   * - Accounts that have ever been banned are never deleted, even if the ban has expired.
   *   This prevents ban evasion by disconnecting OAuth accounts and creating new ones.
   * - Accounts with KYC data are never deleted, as deleting KYC would allow ban evasion
   *   through identity verification bypass.
   * 
   * @param gracePeriodDays - Number of days to wait before considering an account disconnected (default: 30)
   * @param dryRun - If true, only count accounts that would be deleted without actually deleting them
   * @returns CleanupResult with details about the operation
   */
  async cleanupDisconnectedAccounts(
    gracePeriodDays: number = 30,
    dryRun: boolean = false
  ): Promise<CleanupResult> {
    console.log(`🔄 Starting disconnected account cleanup (dryRun: ${dryRun}, gracePeriod: ${gracePeriodDays} days)`);
    
    const result: CleanupResult = {
      success: false,
      deletedCount: 0,
      preservedBannedCount: 0,
      preservedKycCount: 0,
      errors: [],
      details: {
        disconnectedAccounts: 0,
        bannedAccounts: 0,
        kycAccounts: 0,
        accountsWithActiveSessions: 0
      }
    };

    try {
      // Calculate the cutoff date for the grace period
      const gracePeriodCutoff = new Date();
      gracePeriodCutoff.setDate(gracePeriodCutoff.getDate() - gracePeriodDays);

      // First, let's get statistics about the current state
      const totalUsers = await this.prisma.user.count();
      console.log(`📊 Total users in database: ${totalUsers}`);

      // Find users with active sessions (not disconnected)
      const usersWithActiveSessions = await this.prisma.user.findMany({
        where: {
          sessions: {
            some: {
              expiresAt: {
                gt: new Date()
              }
            }
          }
        },
        select: {
          id: true
        }
      });

      result.details.accountsWithActiveSessions = usersWithActiveSessions.length;
      console.log(`📊 Users with active sessions: ${usersWithActiveSessions.length}`);

      // Find currently banned users
      const bannedUsers = await this.prisma.user.findMany({
        where: {
          bannedTill: {
            gt: new Date()
          }
        },
        select: {
          id: true,
          bannedTill: true
        }
      });

      result.details.bannedAccounts = bannedUsers.length;
      result.preservedBannedCount = bannedUsers.length;
      console.log(`📊 Currently banned users: ${bannedUsers.length}`);

      // Find users with KYC data (never delete these to prevent ban evasion)
      const kycUsers = await this.prisma.user.findMany({
        where: {
          kycStatus: {
            not: null
          }
        },
        select: {
          id: true,
          kycStatus: true
        }
      });

      result.details.kycAccounts = kycUsers.length;
      result.preservedKycCount = kycUsers.length;
      console.log(`📊 Users with KYC data: ${kycUsers.length}`);

      // Find disconnected accounts (no active sessions, never been banned, no KYC data, past grace period)
      const disconnectedUsers = await this.prisma.user.findMany({
        where: {
          // No active sessions
          sessions: {
            none: {
              expiresAt: {
                gt: new Date()
              }
            }
          },
          // Never been banned (bannedTill is null - never had a ban)
          bannedTill: null,
          // No KYC data (kycStatus is null - never had KYC verification)
          // SECURITY: Deleting KYC would allow ban evasion through identity verification bypass
          kycStatus: null,
          // Past grace period
          createdAt: {
            lt: gracePeriodCutoff
          }
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          bannedTill: true,
          kycStatus: true,
          onboarded: true
        }
      });

      result.details.disconnectedAccounts = disconnectedUsers.length;
      console.log(`📊 Disconnected accounts found: ${disconnectedUsers.length}`);

      if (disconnectedUsers.length === 0) {
        console.log('ℹ️  No disconnected accounts found for cleanup');
        result.success = true;
        return result;
      }

      // Log details about accounts that will be deleted
      console.log('📋 Accounts to be deleted:');
      disconnectedUsers.forEach(user => {
        const daysSinceCreation = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`  - User ${user.id}: ${user.name || user.email || 'Unknown'} (created ${daysSinceCreation} days ago, onboarded: ${user.onboarded})`);
      });

      if (dryRun) {
        console.log('🔍 DRY RUN: Would delete the above accounts');
        result.deletedCount = disconnectedUsers.length;
        result.success = true;
        return result;
      }

      // Actually delete the disconnected accounts
      console.log('🗑️  Proceeding with account deletion...');
      
      const userIdsToDelete = disconnectedUsers.map(user => user.id);
      
      // Delete users in batches to avoid overwhelming the database
      const batchSize = 50;
      let deletedInThisBatch = 0;
      
      for (let i = 0; i < userIdsToDelete.length; i += batchSize) {
        const batch = userIdsToDelete.slice(i, i + batchSize);
        
        try {
          const deleteResult = await this.prisma.user.deleteMany({
            where: {
              id: {
                in: batch
              }
            }
          });
          
          deletedInThisBatch += deleteResult.count;
          console.log(`✅ Deleted batch ${Math.floor(i / batchSize) + 1}: ${deleteResult.count} accounts`);
          
        } catch (error) {
          const errorMessage = `Failed to delete batch starting at index ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(`❌ ${errorMessage}`);
          result.errors.push(errorMessage);
        }
      }

      result.deletedCount = deletedInThisBatch;
      result.success = result.errors.length === 0;

      console.log(`✅ Cleanup completed: ${result.deletedCount} accounts deleted`);
      console.log(`🛡️  Preserved ${result.preservedBannedCount} banned accounts`);
      console.log(`🛡️  Preserved ${result.preservedKycCount} KYC accounts`);
      console.log(`📊 Details: ${result.details.disconnectedAccounts} disconnected, ${result.details.bannedAccounts} banned, ${result.details.kycAccounts} with KYC, ${result.details.accountsWithActiveSessions} with active sessions`);
      
      if (result.errors.length > 0) {
        console.log('⚠️  Some errors occurred during cleanup:');
        result.errors.forEach(error => console.log(`  - ${error}`));
      }

      return result;

    } catch (error) {
      const errorMessage = `Fatal error during disconnected account cleanup: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`💥 ${errorMessage}`);
      result.errors.push(errorMessage);
      result.success = false;
      return result;
    }
  }

  /**
   * Get statistics about disconnected accounts without deleting them
   */
  async getDisconnectedAccountStats(gracePeriodDays: number = 30): Promise<{
    totalUsers: number;
    usersWithActiveSessions: number;
    bannedUsers: number;
    kycUsers: number;
    disconnectedUsers: number;
    disconnectedUsersDetails: Array<{
      id: number;
      email: string | null;
      name: string | null;
      createdAt: Date;
      onboarded: boolean;
      daysSinceCreation: number;
    }>;
  }> {
    const gracePeriodCutoff = new Date();
    gracePeriodCutoff.setDate(gracePeriodCutoff.getDate() - gracePeriodDays);

    const [
      totalUsers,
      usersWithActiveSessions,
      bannedUsers,
      kycUsers,
      disconnectedUsers
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: {
          sessions: {
            some: {
              expiresAt: {
                gt: new Date()
              }
            }
          }
        }
      }),
      this.prisma.user.count({
        where: {
          bannedTill: {
            gt: new Date()
          }
        }
      }),
      this.prisma.user.count({
        where: {
          kycStatus: {
            not: null
          }
        }
      }),
      this.prisma.user.findMany({
        where: {
          sessions: {
            none: {
              expiresAt: {
                gt: new Date()
              }
            }
          },
          // Never been banned (bannedTill is null - never had a ban)
          bannedTill: null,
          // No KYC data (kycStatus is null - never had KYC verification)
          // SECURITY: Deleting KYC would allow ban evasion through identity verification bypass
          kycStatus: null,
          createdAt: {
            lt: gracePeriodCutoff
          }
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          onboarded: true
        }
      })
    ]);

    const disconnectedUsersDetails = disconnectedUsers.map(user => ({
      ...user,
      daysSinceCreation: Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    }));

    return {
      totalUsers,
      usersWithActiveSessions,
      bannedUsers,
      kycUsers,
      disconnectedUsers: disconnectedUsers.length,
      disconnectedUsersDetails
    };
  }
}
