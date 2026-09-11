import express from 'express';
import { DBLogsService, LogsFilter } from '../services/DBLogsService.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/privilegedAuth.js';
import { prisma } from '../lib/prisma.js';
import { getUserEmailAddresses, obfuscateEmailsInValue } from '../services/userEmailUtils.js';

const router = express.Router();
const dbLogsService = new DBLogsService(prisma);

async function obfuscateUserEmailsInLogs(logs: any[], userId: number) {
  const userEmails = await getUserEmailAddresses(prisma, userId);

  return logs.map(log => ({
    ...log,
    details: obfuscateEmailsInValue(log.details, userEmails),
    request: log.request ? obfuscateEmailsInValue(log.request, userEmails) : log.request,
    response: log.response ? obfuscateEmailsInValue(log.response, userEmails) : log.response,
    error: log.error ? obfuscateEmailsInValue(log.error, userEmails) : log.error
  }));
}

function parseUserLogFilter(query: express.Request['query']): LogsFilter | null {
  const validTypes = ['openai', 'task', 'user', 'session'];
  const type = typeof query.type === 'string' ? query.type : undefined;
  const startDate = typeof query.startDate === 'string' ? new Date(query.startDate) : undefined;
  const endDate = typeof query.endDate === 'string' ? new Date(query.endDate) : undefined;
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);

  if (
    (type !== undefined && !validTypes.includes(type)) ||
    (startDate && Number.isNaN(startDate.getTime())) ||
    (endDate && Number.isNaN(endDate.getTime())) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
  ) {
    return null;
  }

  return { type: type as LogsFilter['type'], startDate, endDate, limit, offset };
}

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
router.get('/', requireAdmin, async (req, res): Promise<void> => {
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
      error: 'Failed to fetch logs'
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
    const parsedFilter = parseUserLogFilter(req.query);
    if (!parsedFilter) {
      res.status(400).json({ error: 'Invalid log filter' });
      return;
    }
    const filter: LogsFilter = { ...parsedFilter, userId };

    const rawLogs = await dbLogsService.getUserLogs(userId, filter);
    const logs = await obfuscateUserEmailsInLogs(rawLogs, userId);

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
      error: 'Failed to fetch user logs'
    });
  }
});

/**
 * GET /api/logs/user/:userId
 * Get logs for a specific user (requires authentication)
 */
router.get('/user/:userId', requireAuth, async (req, res): Promise<void> => {
  try {
    const requestedUserId = parseInt(req.params.userId as string);
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

    const parsedFilter = parseUserLogFilter(req.query);
    if (!parsedFilter) {
      res.status(400).json({ error: 'Invalid log filter' });
      return;
    }
    const filter: LogsFilter = { ...parsedFilter, userId: requestedUserId };

    const rawLogs = await dbLogsService.getUserLogs(requestedUserId, filter);
    const logs = await obfuscateUserEmailsInLogs(rawLogs, requestedUserId);

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
      error: 'Failed to fetch user logs'
    });
  }
});

/**
 * GET /api/logs/stats
 * Get log statistics
 */
router.get('/stats', requireAdmin, async (req, res): Promise<void> => {
  try {
    const stats = await dbLogsService.getLogStats();

    res.json({
      success: true,
      stats
    });

  } catch (error: any) {
    console.error('Error fetching log stats:', error);
    res.status(500).json({
      error: 'Failed to fetch log statistics'
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
        fields: [/*'email',*/ 'name', 'ethereumAddress', 'orcidId', 'githubHandle', 'shareInGDP'] // Don't show emails publicly.
      },
      session: {
        name: 'Authentication Session Logs',
        description: 'User authentication sessions',
        fields: ['expiresAt', 'isExpired']
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
