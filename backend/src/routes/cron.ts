import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { CronService } from '../services/CronService.js';

const router = Router();
const prisma = new PrismaClient();
const cronService = new CronService(prisma);

// Note: Start/stop/run endpoints have been removed for security reasons.
// The cron service is designed to run automatically and should not be controlled via public API.

/**
 * GET /api/cron/status
 * Get the current status of cron jobs
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = cronService.getCronStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting cron status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cron status'
    });
  }
});


/**
 * GET /api/cron/eligible-users
 * Get the list of users eligible for bi-monthly evaluation
 * Useful for debugging and monitoring
 */
router.get('/eligible-users', async (req: Request, res: Response) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const eligibleUsers = await prisma.user.findMany({
      where: {
        onboarded: true,
        updatedAt: {
          lt: oneMonthAgo
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        onboarded: true,
        updatedAt: true,
        orcidId: true,
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true
      },
      orderBy: {
        updatedAt: 'asc'
      }
    });

    res.json({
      success: true,
      data: {
        eligibleUsers,
        count: eligibleUsers.length,
        cutoffDate: oneMonthAgo
      }
    });
  } catch (error) {
    console.error('Error getting eligible users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get eligible users'
    });
  }
});

export default router;
