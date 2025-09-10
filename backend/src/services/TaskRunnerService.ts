import { PrismaClient } from '@prisma/client';
import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task';

export class TaskRunnerService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Register a TaskRunner in the database
   */
  async registerRunner(
    name: string, 
    className: string
  ): Promise<void> {
    await this.prisma.taskRunner.upsert({
      where: { name },
      update: {
        className,
        updatedAt: new Date(),
      },
      create: {
        name,
        className,
      },
    });
  }

  /**
   * Get a TaskRunner by name from the database
   */
  async getRunner(name: string) {
    return await this.prisma.taskRunner.findUnique({
      where: { name },
    });
  }

  /**
   * Get all TaskRunners from the database
   */
  async getAllRunners() {
    return await this.prisma.taskRunner.findMany({
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create and execute a TaskRunner instance
   */
  async createAndExecuteRunner(
    runnerName: string, 
    data: TaskRunnerData
  ): Promise<TaskRunner | null> {
    // Get runner info from database
    const runnerInfo = await this.getRunner(runnerName);
    if (!runnerInfo) {
      console.error(`TaskRunner '${runnerName}' not found in database`);
      return null;
    }


    // Create runner instance using the registry
    return TaskRunnerRegistry.createRunner(runnerInfo.className, data);
  }


  /**
   * Delete a TaskRunner (only if no tasks are using it)
   */
  async deleteRunner(name: string): Promise<boolean> {
    // Check if any tasks are using this runner
    const tasksUsingRunner = await this.prisma.task.count({
      where: { 
        runner: { name },
        status: { in: ['PENDING', 'IN_PROGRESS'] }
      },
    });

    if (tasksUsingRunner > 0) {
      console.error(`Cannot delete TaskRunner '${name}' - ${tasksUsingRunner} active tasks are using it`);
      return false;
    }

    await this.prisma.taskRunner.delete({
      where: { name },
    });

    return true;
  }

  /**
   * Initialize default TaskRunners in the database
   */
  async initializeDefaultRunners(): Promise<void> {
    const defaultRunners = [
      {
        name: 'EmailRunner',
        className: 'EmailRunner',
      },
      {
        name: 'FileProcessorRunner',
        className: 'FileProcessorRunner',
      },
      {
        name: 'ApiCallRunner',
        className: 'ApiCallRunner',
      },
      {
        name: 'DatabaseRunner',
        className: 'DatabaseRunner',
      },
    ];

    for (const runner of defaultRunners) {
      await this.registerRunner(runner.name, runner.className);
    }

    console.log('✅ Default TaskRunners initialized in database');
  }
}
