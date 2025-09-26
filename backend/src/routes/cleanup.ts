import { Router, Request, Response } from 'express';
import { DisconnectedAccountCleanupService } from '../services/DisconnectedAccountCleanupService.js';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();
const cleanupService = new DisconnectedAccountCleanupService(prisma);

/**
 * GET /api/cleanup/stats
 * Get statistics about disconnected accounts without deleting them
 * Requires authentication
 */
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const gracePeriodDays = parseInt(req.query.gracePeriodDays as string) || 30;
    
    if (gracePeriodDays < 1 || gracePeriodDays > 365) {
      res.status(400).json({
        success: false,
        error: 'Grace period must be between 1 and 365 days'
      });
      return;
    }

    const stats = await cleanupService.getDisconnectedAccountStats(gracePeriodDays);
    
    res.json({
      success: true,
      data: {
        ...stats,
        gracePeriodDays,
        summary: {
          totalUsers: stats.totalUsers,
          activeUsers: stats.usersWithActiveSessions,
          bannedUsers: stats.bannedUsers,
          kycUsers: stats.kycUsers,
          disconnectedUsers: stats.disconnectedUsers,
          percentageDisconnected: stats.totalUsers > 0 ? 
            ((stats.disconnectedUsers / stats.totalUsers) * 100).toFixed(2) + '%' : '0%'
        },
        security: {
          preservedBannedAccounts: stats.bannedUsers,
          preservedKycAccounts: stats.kycUsers,
          note: 'Banned and KYC accounts are never deleted to prevent ban evasion'
        }
      }
    });
  } catch (error) {
    console.error('Error getting cleanup stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cleanup statistics'
    });
  }
});

/**
 * POST /api/cleanup/dry-run
 * Perform a dry run of the cleanup process to see what would be deleted
 * Requires authentication
 */
router.post('/dry-run', requireAuth, async (req: Request, res: Response) => {
  try {
    const { gracePeriodDays = 30 } = req.body;
    
    if (gracePeriodDays < 1 || gracePeriodDays > 365) {
      res.status(400).json({
        success: false,
        error: 'Grace period must be between 1 and 365 days'
      });
      return;
    }

    const result = await cleanupService.cleanupDisconnectedAccounts(gracePeriodDays, true);
    
    res.json({
      success: true,
      data: {
        ...result,
        gracePeriodDays,
        message: 'This was a dry run - no accounts were actually deleted',
        security: {
          preservedBannedAccounts: result.preservedBannedCount,
          preservedKycAccounts: result.preservedKycCount,
          note: 'Banned and KYC accounts are never deleted to prevent ban evasion'
        }
      }
    });
  } catch (error) {
    console.error('Error performing cleanup dry run:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform cleanup dry run'
    });
  }
});

/**
 * POST /api/cleanup/execute
 * Execute the actual cleanup process to delete disconnected accounts
 * Requires authentication
 * WARNING: This will permanently delete user accounts and their data
 * SECURITY: Banned and KYC accounts are never deleted to prevent ban evasion
 */
router.post('/execute', requireAuth, async (req: Request, res: Response) => {
  try {
    const { gracePeriodDays = 30, confirmDeletion = false } = req.body;
    
    if (!confirmDeletion) {
      res.status(400).json({
        success: false,
        error: 'You must confirm the deletion by setting confirmDeletion to true. This action cannot be undone.'
      });
      return;
    }
    
    if (gracePeriodDays < 1 || gracePeriodDays > 365) {
      res.status(400).json({
        success: false,
        error: 'Grace period must be between 1 and 365 days'
      });
      return;
    }

    const result = await cleanupService.cleanupDisconnectedAccounts(gracePeriodDays, false);
    
    res.json({
      success: true,
      data: {
        ...result,
        gracePeriodDays,
        message: 'Cleanup completed. Disconnected accounts have been permanently deleted.',
        security: {
          preservedBannedAccounts: result.preservedBannedCount,
          preservedKycAccounts: result.preservedKycCount,
          note: 'Banned and KYC accounts were preserved to prevent ban evasion'
        }
      }
    });
  } catch (error) {
    console.error('Error executing cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute cleanup'
    });
  }
});

export default router;
