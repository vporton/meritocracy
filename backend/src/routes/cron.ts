import { Request, Response, Router } from 'express';
import { CronExecutionLockedError, cronJobMetadata } from '../services/CronService.js';
import { cronService } from '../services/cronServiceInstance.js';
import { requireAdmin, requireCron } from '../middleware/privilegedAuth.js';

const router = Router();

function scheduleCronJob(jobName: string, cronExpression: string, runner: () => Promise<unknown>) {
  try {
    console.log(`🕐 Cron-job.org triggered "${jobName}" (scheduled cron: ${cronExpression})`);
    const jobPromise = runner();
    jobPromise.catch(error => console.error(`💥 Cron-job.org background job "${jobName}" failed:`, error));
    return { status: 'scheduled' as const };
  } catch (error) {
    if (error instanceof CronExecutionLockedError) {
      console.log(`⏭️ Cron-job.org request for "${jobName}" skipped because a task is already running.`);
      return { status: 'locked' as const, error };
    }

    console.error(`💥 Cron-job.org request for "${jobName}" failed to start:`, error);
    return { status: 'error' as const, error };
  }
}

const respondToJobRequest = (jobName: string, result: ReturnType<typeof scheduleCronJob>, res: Response, successMessage: string) => {
  if (result.status === 'locked') {
    res.status(409).json({ success: false, error: result.error.message });
  } else if (result.status === 'error') {
    res.status(500).json({ success: false, error: 'Failed to start the cron job' });
  } else {
    res.status(202).json({ success: true, message: successMessage });
  }
};

/**
 * POST /api/cron/quarterly-evaluation
 * scheduled via https://cron-job.org
 */
router.post('/quarterly-evaluation', requireCron, (req, res) => {
  const result = scheduleCronJob('quarterly evaluation', cronJobMetadata.quarterlyEvaluation.cron, () => cronService.runQuarterlyEvaluation());
  respondToJobRequest('quarterly evaluation', result, res, 'Quarterly evaluation queued (background job is running).');
});

/**
 * POST /api/cron/bi-monthly-evaluation
 * Backward-compatible alias; now runs the quarterly evaluation cadence.
 */
router.post('/bi-monthly-evaluation', requireCron, (req, res) => {
  const result = scheduleCronJob('quarterly evaluation', cronJobMetadata.quarterlyEvaluation.cron, () => cronService.runQuarterlyEvaluation());
  respondToJobRequest('quarterly evaluation', result, res, 'Quarterly evaluation queued (background job is running).');
});

/**
 * POST /api/cron/weekly-gas-distribution
 * scheduled via https://cron-job.org
 */
router.post('/weekly-gas-distribution', requireCron, (req, res) => {
  const result = scheduleCronJob('weekly gas distribution', cronJobMetadata.weeklyGasDistribution.cron, () => cronService.runWeeklyGasDistribution());
  respondToJobRequest('weekly gas distribution', result, res, 'Weekly gas distribution queued (background job is running).');
});

/**
 * POST /api/cron/compensation-payout
 * scheduled via https://cron-job.org
 */
router.post('/compensation-payout', requireCron, (req, res) => {
  const result = scheduleCronJob('compensation payouts', cronJobMetadata.compensationPayout.cron, () => cronService.runCompensationPayouts());
  respondToJobRequest('compensation payouts', result, res, 'Compensation payout queued (background job is running).');
});

/**
 * POST /api/cron/liveliness-check
 * scheduled daily via https://cron-job.org
 */
router.post('/liveliness-check', requireCron, (req, res) => {
  const result = scheduleCronJob('liveliness checks', cronJobMetadata.livelinessCheck.cron, () => cronService.runLivelinessChecks());
  respondToJobRequest('liveliness checks', result, res, 'Liveliness renewal check queued (background job is running).');
});

/**
 * POST /api/cron/monthly-cleanup
 * scheduled via https://cron-job.org
 */
router.post('/monthly-cleanup', requireCron, (req, res) => {
  const result = scheduleCronJob('monthly cleanup', cronJobMetadata.monthlyCleanup.cron, () => cronService.runMonthlyCleanup());
  respondToJobRequest('monthly cleanup', result, res, 'Monthly cleanup queued (background job is running).');
});

/**
 * POST /api/cron/world-gdp-refresh
 * scheduled via https://cron-job.org
 */
router.post('/world-gdp-refresh', requireCron, (req, res) => {
  const result = scheduleCronJob('world GDP refresh', cronJobMetadata.worldGdpRefresh.cron, () => cronService.runWorldGdpRefresh());
  respondToJobRequest('world GDP refresh', result, res, 'World GDP refresh queued (background job is running).');
});

/**
 * GET /api/cron/status
 * Public, returns metadata about cron-job.org driven schedules
 */
router.get('/status', requireAdmin, (req: Request, res: Response) => {
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

export default router;
