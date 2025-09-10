import { PrismaClient } from '@prisma/client';
import { TaskRunnerData } from '../types/task';

export class TaskRunnerDataService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new TaskRunnerData entry
   */
  async createRunnerData(
    name: string,
    data: any
  ): Promise<any> {
    return await this.prisma.taskRunnerData.create({
      data: {
        name,
        data: JSON.stringify(data),
      },
    });
  }

  /**
   * Get TaskRunnerData by ID
   */
  async getRunnerData(id: number) {
    return await this.prisma.taskRunnerData.findUnique({
      where: { id },
    });
  }

  /**
   * Get TaskRunnerData by name
   */
  async getRunnerDataByName(name: string) {
    return await this.prisma.taskRunnerData.findFirst({
      where: { name },
    });
  }

  /**
   * Get all TaskRunnerData entries
   */
  async getAllRunnerData() {
    return await this.prisma.taskRunnerData.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Update TaskRunnerData
   */
  async updateRunnerData(
    id: number,
    updates: {
      name?: string;
      data?: any;
    }
  ) {
    const updateData: any = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.data !== undefined) updateData.data = JSON.stringify(updates.data);
    
    updateData.updatedAt = new Date();

    return await this.prisma.taskRunnerData.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Delete TaskRunnerData (only if no tasks are using it)
   */
  async deleteRunnerData(id: number): Promise<boolean> {
    // Check if any tasks are using this runner data
    const tasksUsingData = await this.prisma.task.count({
      where: { 
        runnerDataId: id,
        status: { in: ['PENDING', 'IN_PROGRESS'] }
      },
    });

    if (tasksUsingData > 0) {
      console.error(`Cannot delete TaskRunnerData ID ${id} - ${tasksUsingData} active tasks are using it`);
      return false;
    }

    await this.prisma.taskRunnerData.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Parse TaskRunnerData JSON and return as object
   */
  parseRunnerData(runnerData: any): any {
    try {
      return JSON.parse(runnerData.data);
    } catch (error) {
      console.error('Failed to parse TaskRunnerData:', error);
      return {};
    }
  }

  /**
   * Create default TaskRunnerData configurations
   */
  async initializeDefaultRunnerData(): Promise<void> {
    const defaultData = [
      {
        name: 'Welcome Email Data',
        data: {
          to: 'user@example.com',
          subject: 'Welcome to our service!',
          body: 'Thank you for signing up. We are excited to have you on board!'
        },
      },
      {
        name: 'File Compression Data',
        data: {
          filePath: '/uploads/document.pdf',
          operation: 'compress'
        },
      },
      {
        name: 'API Webhook Data',
        data: {
          url: 'https://api.example.com/webhook',
          method: 'POST',
          payload: { event: 'task_completed' }
        },
      },
      {
        name: 'Database Backup Data',
        data: {
          operation: 'backup',
          table: 'users',
          query: 'SELECT * FROM users WHERE created_at > NOW() - INTERVAL 1 DAY'
        },
      },
    ];

    for (const dataConfig of defaultData) {
      await this.createRunnerData(
        dataConfig.name,
        dataConfig.data
      );
    }

    console.log('✅ Default TaskRunnerData configurations initialized in database');
  }
}
