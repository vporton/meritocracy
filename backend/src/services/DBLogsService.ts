import { PrismaClient, OpenAILog, Task, User, Session } from '@prisma/client';

export interface DBLogEntry {
  id: string;
  type: 'openai' | 'task' | 'user' | 'session';
  timestamp: Date;
  userId?: number;
  taskId?: number;
  action: string;
  details: any;
  status?: string;
  error?: string;
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
    
    return logs.slice(offset, offset + limit);
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
            name: true,
            email: true
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

    return logs.map(log => ({
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
        requestData: log.requestData ? JSON.parse(log.requestData) : null,
        responseData: log.responseData ? JSON.parse(log.responseData) : null,
        user: log.user,
        task: log.task
      },
      status: log.responseReceived ? 'completed' : 'pending',
      error: log.errorMessage || undefined
    }));
  }

  /**
   * Get Task execution logs
   */
  private async getTaskLogs(filter: LogsFilter): Promise<DBLogEntry[]> {
    const where: any = {};
    
    if (filter.userId) {
      // Find tasks that contain this userId in their runnerData
      where.runnerData = {
        contains: `"userId":${filter.userId}`
      };
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

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        openaiLogs: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
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
        email: user.email,
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
            name: true,
            email: true
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
}
