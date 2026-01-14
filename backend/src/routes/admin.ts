import express from 'express';
import { GlobalDataService } from '../services/GlobalDataService.js';
import { CronService } from '../services/CronService.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();
const cronService = new CronService(prisma);

// Middleware to check admin password
const authAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const adminPassword = process.env.ADMIN_PASSWORD;
    const providedPassword = req.headers['x-admin-password'];

    if (!adminPassword) {
        res.status(500).json({ error: 'Admin password not configured on server' });
        return;
    }

    if (providedPassword !== adminPassword) {
        res.status(401).json({ error: 'Unauthorized: Invalid admin password' });
        return;
    }

    next();
};

/**
 * GET /api/admin/status
 * Get the current status of the crypto distribution
 */
router.get('/status', authAdmin, async (req, res) => {
    try {
        const isEnabled = await GlobalDataService.isGasDistributionEnabled();
        const cronStatus = cronService.getCronStatus();

        res.json({
            gasDistributionEnabled: isEnabled,
            cronStatus: cronStatus.weeklyGasDistribution
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get status' });
    }
});

/**
 * POST /api/admin/toggle-distribution
 * Enable or disable crypto distribution
 */
router.post('/toggle-distribution', authAdmin, async (req: express.Request, res: express.Response) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'Invalid enabled status' });
        return;
    }

    try {
        const success = await GlobalDataService.setGasDistributionEnabled(enabled);
        if (success) {
            res.json({ message: `Gas distribution ${enabled ? 'enabled' : 'disabled'} successfully`, enabled });
        } else {
            res.status(500).json({ error: 'Failed to update gas distribution status' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle distribution' });
    }
});

/**
 * POST /api/admin/trigger-distribution
 * Manually trigger the crypto distribution
 */
router.post('/trigger-distribution', authAdmin, async (req, res) => {
    try {
        // Note: This starts the distribution process in the background if it's long-running,
        // or waits for it if it's manageable. In CronService it returns the result.
        const result = await cronService.runWeeklyGasDistribution(true);
        res.json({ message: 'Distribution triggered successfully', result });
    } catch (error) {
        console.error('Error triggering distribution:', error);
        res.status(500).json({ error: 'Failed to trigger distribution', message: error instanceof Error ? error.message : 'Unknown error' });
    }
});

export default router;
