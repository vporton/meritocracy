import { Router, Request, Response } from 'express';
import { CronService } from '../services/CronService.js';
import { PrismaClient } from '@prisma/client';

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


// Note: All potentially insecure routes have been removed for security reasons.
// The following routes were removed:
// - GET /api/cron/eligible-users (exposed user personal data)
// - POST /api/cron/run-gas-distribution (allowed manual triggering of financial transactions)
// - GET /api/cron/gas-distribution-history (exposed financial transaction history)
// - GET /api/cron/gas-reserve-status (exposed financial status information)
//
// Only the status endpoint remains as it provides minimal operational information
// without exposing sensitive data or allowing dangerous operations.

export default router;
