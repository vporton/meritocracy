import express from 'express';
import { PrismaClient } from '@prisma/client';
import { DBLogsService, LogsFilter } from '../services/DBLogsService.js';
import { requireAuth, getCurrentUserFromToken } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();
const dbLogsService = new DBLogsService(prisma);

// Remove duplicate auth middleware - now imported from shared module

/**
 * GET /api/logs
 * Get all database logs with optional filtering
 * Query parameters:
 * - userId: Filter by specific user ID
 * - taskId: Filter by specific task ID
 * - type: Filter by log type (openai, task, user, session)
 * - startDate: Filter logs from this date (ISO string)
 * - endDate: Filter logs to this date (ISO string)
 * - limit: Number of logs to return (default: 100)
 * - offset: Number of logs to skip (default: 0)
 */
router.get('/', async (req, res): Promise<void> => {
  try {
    const {
      userId,
      taskId,
      type,
      startDate,
      endDate,
      limit,
      offset
    } = req.query;

    const filter: LogsFilter = {};

    if (userId) {
      filter.userId = parseInt(userId as string);
      if (isNaN(filter.userId)) {
        res.status(400).json({ error: 'Invalid userId parameter' });
        return;
      }
    }

    if (taskId) {
      filter.taskId = parseInt(taskId as string);
      if (isNaN(filter.taskId)) {
        res.status(400).json({ error: 'Invalid taskId parameter' });
        return;
      }
    }

    if (type) {
      const validTypes = ['openai', 'task', 'user', 'session'];
      if (!validTypes.includes(type as string)) {
        res.status(400).json({ 
          error: 'Invalid type parameter. Must be one of: ' + validTypes.join(', ')
        });
        return;
      }
      filter.type = type as 'openai' | 'task' | 'user' | 'session';
    }

    if (startDate) {
      filter.startDate = new Date(startDate as string);
      if (isNaN(filter.startDate.getTime())) {
        res.status(400).json({ error: 'Invalid startDate parameter. Use ISO date format.' });
        return;
      }
    }

    if (endDate) {
      filter.endDate = new Date(endDate as string);
      if (isNaN(filter.endDate.getTime())) {
        res.status(400).json({ error: 'Invalid endDate parameter. Use ISO date format.' });
        return;
      }
    }

    if (limit) {
      filter.limit = parseInt(limit as string);
      if (isNaN(filter.limit) || filter.limit < 1 || filter.limit > 1000) {
        res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 1000.' });
        return;
      }
    }

    if (offset) {
      filter.offset = parseInt(offset as string);
      if (isNaN(filter.offset) || filter.offset < 0) {
        res.status(400).json({ error: 'Invalid offset parameter. Must be >= 0.' });
        return;
      }
    }

    const logs = await dbLogsService.getLogs(filter);

    res.json({
      success: true,
      logs,
      count: logs.length,
      filter
    });

  } catch (error: any) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch logs',
      message: error.message 
    });
  }
});

/**
 * GET /api/logs/my
 * Get logs for the current authenticated user
 */
router.get('/my', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId;
    const {
      type,
      startDate,
      endDate,
      limit,
      offset
    } = req.query;

    const filter: LogsFilter = {
      userId,
      type: type as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const logs = await dbLogsService.getUserLogs(userId, filter);

    res.json({
      success: true,
      logs,
      count: logs.length,
      userId,
      filter
    });

  } catch (error: any) {
    console.error('Error fetching user logs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user logs',
      message: error.message 
    });
  }
});

/**
 * GET /api/logs/user/:userId
 * Get logs for a specific user (requires authentication)
 */
router.get('/user/:userId', requireAuth, async (req, res): Promise<void> => {
  try {
    const requestedUserId = parseInt(req.params.userId);
    const authenticatedUserId = (req as any).userId;
    
    if (isNaN(requestedUserId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    // Users can only access their own logs
    if (requestedUserId !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only access your own logs' });
      return;
    }

    const {
      type,
      startDate,
      endDate,
      limit,
      offset
    } = req.query;

    const filter: LogsFilter = {
      userId: requestedUserId,
      type: type as any,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const logs = await dbLogsService.getUserLogs(requestedUserId, filter);

    res.json({
      success: true,
      logs,
      count: logs.length,
      userId: requestedUserId,
      filter
    });

  } catch (error: any) {
    console.error('Error fetching user logs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user logs',
      message: error.message 
    });
  }
});

/**
 * GET /api/logs/stats
 * Get log statistics
 */
router.get('/stats', async (req, res): Promise<void> => {
  try {
    const stats = await dbLogsService.getLogStats();

    res.json({
      success: true,
      stats
    });

  } catch (error: any) {
    console.error('Error fetching log stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch log statistics',
      message: error.message 
    });
  }
});

/**
 * GET /api/logs/types
 * Get available log types and their descriptions
 */
router.get('/types', async (req, res): Promise<void> => {
  try {
    const logTypes = {
      openai: {
        name: 'OpenAI API Logs',
        description: 'API requests and responses to OpenAI services',
        fields: ['customId', 'storeId', 'runnerClassName', 'request.data', 'response.data', 'errorMessage'],
        structure: {
          request: 'Contains the data sent to OpenAI API',
          response: 'Contains the data received from OpenAI API',
          details: 'Contains metadata like timestamps and user info'
        }
      },
      task: {
        name: 'Task Execution Logs',
        description: 'Task execution status and runner data',
        fields: ['runnerClassName', 'status', 'runnerData', 'dependencies']
      },
      user: {
        name: 'User Account Logs',
        description: 'User account creation and updates',
        fields: ['email', 'name', 'ethereumAddress', 'orcidId', 'githubHandle', 'shareInGDP']
      },
      session: {
        name: 'Authentication Session Logs',
        description: 'User authentication sessions',
        fields: ['token', 'expiresAt', 'isExpired']
      }
    };

    res.json({
      success: true,
      logTypes
    });

  } catch (error: any) {
    console.error('Error fetching log types:', error);
    res.status(500).json({ 
      error: 'Failed to fetch log types',
      message: error.message 
    });
  }
});

export default router;
