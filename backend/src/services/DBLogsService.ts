import { PrismaClient } from '@prisma/client';

export interface DBLogEntry {
  id: string;
  type: 'openai' | 'task' | 'user' | 'session';
  timestamp: Date;
  userId?: number;
  user?: {
    id: number;
    name?: string | null;
    ethereumAddress?: string | null;
    solanaAddress?: string | null;
    bitcoinAddress?: string | null;
    bitcoinCashAddress?: string | null;
    polkadotAddress?: string | null;
    cosmosAddress?: string | null;
    stellarAddress?: string | null;
    icpAddress?: string | null;
    orcidId?: string | null;
    githubHandle?: string | null;
    bitbucketHandle?: string | null;
    gitlabHandle?: string | null;
  };
  taskId?: number;
  action: string;
  details: any;
  status?: string;
  error?: string;
  deleted?: boolean;
}

export interface LogsFilter {
  userId?: number;
  taskId?: number;
  type?: 'openai' | 'task' | 'user' | 'session';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class DBLogsService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get all database logs with optional filtering
   */
  async getLogs(filter: LogsFilter = {}): Promise<DBLogEntry[]> {
    const logs: DBLogEntry[] = [];

    // Get OpenAI logs
    if (!filter.type || filter.type === 'openai') {
      const openaiLogs = await this.getOpenAILogs(filter);
      logs.push(...openaiLogs);
    }

    // Get Task logs
    if (!filter.type || filter.type === 'task') {
      const taskLogs = await this.getTaskLogs(filter);
      logs.push(...taskLogs);
    }

    // Get User logs
    if (!filter.type || filter.type === 'user') {
      const userLogs = await this.getUserAccountLogs(filter);
      logs.push(...userLogs);
    }

    // Get Session logs
    if (!filter.type || filter.type === 'session') {
      const sessionLogs = await this.getSessionLogs(filter);
      logs.push(...sessionLogs);
    }

    // Sort by timestamp (newest first)
    logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    const paginatedLogs = logs.slice(offset, offset + limit);

    return this.enrichLogsWithUsers(paginatedLogs);
  }

  /**
   * Get logs for a specific user
   */
  async getUserLogs(userId: number, filter: Omit<LogsFilter, 'userId'> = {}): Promise<DBLogEntry[]> {
    return this.getLogs({ ...filter, userId });
  }

  /**
   * Get OpenAI API logs
   */
  private async getOpenAILogs(filter: LogsFilter): Promise<DBLogEntry[]> {
    const where: any = {};

    if (filter.userId) {
      where.userId = filter.userId;
    }

    if (filter.taskId) {
      where.taskId = filter.taskId;
    }

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) {
        where.createdAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.createdAt.lte = filter.endDate;
      }
    }

    const logs = await this.prisma.openAILog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true
          }
        },
        task: {
          select: {
            id: true,
            status: true,
            runnerClassName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    const results = await this.prisma.aiResult.findMany({
      where: { customId: { in: logs.map(log => log.customId) } },
      include: { sources: { orderBy: { ordinal: 'asc' } } },
    });
    const resultByCustomId = new Map(results.map(result => [result.customId, result]));

    return logs.map(log => {
      const result = resultByCustomId.get(log.customId);
      return {
      id: `openai-${log.id}`,
      type: 'openai' as const,
      timestamp: log.createdAt,
      userId: log.userId || undefined,
      taskId: log.taskId || undefined,
      action: 'OpenAI API Request',
      details: {
        customId: log.customId,
        storeId: log.storeId,
        runnerClassName: log.runnerClassName,
        requestInitiated: log.requestInitiated,
        responseReceived: log.responseReceived,
        user: log.user,
        task: log.task
      },
      // Clearly separate request and response data
      request: {
        data: log.requestData ? JSON.parse(log.requestData) : null,
        timestamp: log.requestInitiated,
        status: 'sent'
      },
      response: {
        data: result ? { result: result.result, sources: result.sources.map(source => source.url) } : null,
        timestamp: result?.responseReceived ?? log.responseReceived,
        status: result?.status.toLowerCase() ?? (log.responseReceived ? 'received' : 'pending'),
        error: log.errorMessage || null
      },
      status: result?.status.toLowerCase() ?? (log.responseReceived ? 'completed' : 'pending'),
      error: log.errorMessage || undefined
    };
    });
  }

  /**
   * Get Task execution logs
   */
  private async getTaskLogs(filter: LogsFilter): Promise<DBLogEntry[]> {
    const where: any = {};
    const andConditions: any[] = [];

    if (filter.userId) {
      // Task runner data is stored as JSON text, so accept both compact and spaced encodings.
      andConditions.push({
        OR: [
          {
            runnerData: {
              contains: `"userId":${filter.userId}`
            }
          },
          {
            runnerData: {
              contains: `"userId": ${filter.userId}`
            }
          }
        ]
      });
    }

    if (filter.taskId) {
      where.id = filter.taskId;
    }

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) {
        where.createdAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.createdAt.lte = filter.endDate;
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        openaiLogs: {
          include: {
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return tasks.map(task => {
      let action = 'Task Execution';
      let details: any = {
        runnerClassName: task.runnerClassName,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt
      };

      // Parse runner data to extract more details
      if (task.runnerData) {
        try {
          const runnerData = JSON.parse(task.runnerData);
          details.runnerData = runnerData;

          // Extract user ID from runner data if present
          if (runnerData.userId) {
            details.userId = runnerData.userId;
          }
        } catch (error) {
          details.runnerDataRaw = task.runnerData;
        }
      }

      // Add OpenAI logs associated with this task
      if (task.openaiLogs.length > 0) {
        details.openaiLogs = task.openaiLogs.map(log => ({
          id: log.id,
          customId: log.customId,
          status: log.responseReceived ? 'completed' : 'pending',
          error: log.errorMessage
        }));
      }

      return {
        id: `task-${task.id}`,
        type: 'task' as const,
        timestamp: task.createdAt,
        userId: details.userId,
        taskId: task.id,
        action,
        details,
        status: task.status,
        deleted: task.isDeleted,
        error: task.status === 'CANCELLED' ? 'Task was cancelled' : undefined
      };
    });
  }

  /**
   * Get User account logs
   */
  private async getUserAccountLogs(filter: LogsFilter): Promise<DBLogEntry[]> {
    const where: any = {};

    if (filter.userId) {
      where.id = filter.userId;
    }

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) {
        where.createdAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.createdAt.lte = filter.endDate;
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        sessions: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 5 // Limit to recent sessions
        },
        openaiLogs: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Limit to recent OpenAI logs
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return users.map(user => ({
      id: `user-${user.id}`,
      type: 'user' as const,
      timestamp: user.createdAt,
      userId: user.id,
      action: 'User Account',
        details: {
          id: user.id,
          name: user.name,
          ethereumAddress: user.ethereumAddress,
          orcidId: user.orcidId,
          githubHandle: user.githubHandle,
          bitbucketHandle: user.bitbucketHandle,
          gitlabHandle: user.gitlabHandle,
          shareInGDP: user.shareInGDP,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          bannedTill: user.bannedTill,
          lastPaymentAmount: user.lastPaymentAmount,
          recentSessions: user.sessions.length,
          recentOpenAILogs: user.openaiLogs.length
        },
      status: user.bannedTill && user.bannedTill > new Date() ? 'banned' : 'active'
    }));
  }

  /**
   * Get Session logs
   */
  private async getSessionLogs(filter: LogsFilter): Promise<DBLogEntry[]> {
    const where: any = {};

    if (filter.userId) {
      where.userId = filter.userId;
    }

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) {
        where.createdAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.createdAt.lte = filter.endDate;
      }
    }

    const sessions = await this.prisma.session.findMany({
      where,
      include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return sessions.map(session => ({
      id: `session-${session.id}`,
      type: 'session' as const,
      timestamp: session.createdAt,
      userId: session.userId,
      action: 'Authentication Session',
      details: {
        id: session.id,
        token: session.token.substring(0, 20) + '...', // Truncate token for security
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        user: session.user,
        isExpired: session.expiresAt < new Date()
      },
      status: session.expiresAt < new Date() ? 'expired' : 'active'
    }));
  }

  /**
   * Get log statistics
   */
  async getLogStats(): Promise<{
    totalLogs: number;
    logsByType: Record<string, number>;
    logsByUser: Record<number, number>;
    recentActivity: number;
  }> {
    const [openaiCount, taskCount, userCount, sessionCount] = await Promise.all([
      this.prisma.openAILog.count(),
      // Tasks are part of the historical audit trail, so count soft-deleted rows too.
      this.prisma.task.count(),
      this.prisma.user.count(),
      this.prisma.session.count()
    ]);

    const totalLogs = openaiCount + taskCount + userCount + sessionCount;

    // Get logs by user (from OpenAI logs and tasks)
    const userLogCounts = await this.prisma.openAILog.groupBy({
      by: ['userId'],
      _count: {
        userId: true
      },
      where: {
        userId: {
          not: null
        }
      }
    });

    const logsByUser: Record<number, number> = {};
    userLogCounts.forEach(group => {
      if (group.userId) {
        logsByUser[group.userId] = group._count.userId;
      }
    });

    // Get recent activity (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const recentActivity = await this.prisma.openAILog.count({
      where: {
        createdAt: {
          gte: yesterday
        }
      }
    });

    return {
      totalLogs,
      logsByType: {
        openai: openaiCount,
        task: taskCount,
        user: userCount,
        session: sessionCount
      },
      logsByUser,
      recentActivity
    };
  }

  /**
   * Attach user names and account fields to logs for compact frontend rendering.
   */
  private async enrichLogsWithUsers(logs: DBLogEntry[]): Promise<DBLogEntry[]> {
    const userIds = Array.from(
      new Set(
        logs
          .map(log => log.userId)
          .filter((userId): userId is number => typeof userId === 'number')
      )
    );

    if (userIds.length === 0) {
      return logs;
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        ethereumAddress: true,
        solanaAddress: true,
        bitcoinAddress: true,
        bitcoinCashAddress: true,
        polkadotAddress: true,
        cosmosAddress: true,
        stellarAddress: true,
        icpAddress: true,
        orcidId: true,
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true
      }
    });

    const userById = new Map(users.map(user => [user.id, user]));

    return logs.map(log => {
      if (!log.userId) {
        return log;
      }

      return {
        ...log,
        user: userById.get(log.userId)
      };
    });
  }
}
