import { PrismaClient } from '@prisma/client';
import { TaskStatus, TaskRunnerData } from '../types/task';

export class TaskExecutor {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Execute a single task by creating and running its TaskRunner
   */
  async executeTask(taskId: number): Promise<boolean> {
    try {
      // Get the task from database
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: {
          dependencies: {
            include: {
              dependency: true,
            },
          },
        },
      });

      if (!task) {
        console.error(`Task with ID ${taskId} not found`);
        return false;
      }

      // Check if task is ready to run (all dependencies completed)
      if (!this.isTaskReady(task)) {
        console.log(`Task ${taskId} is not ready to run - dependencies not completed`);
        return false;
      }

      // Check if task has a runner specified
      if (!task.runnerClassName) {
        console.error(`Task ${taskId} has no runner class specified`);
        return false;
      }

      // Update task status to IN_PROGRESS
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      console.log(`🚀 Starting execution of task ${taskId} with runner: ${task.runnerClassName || 'Unknown'}`);

      // Parse runner data
      let runnerData: TaskRunnerData = {};
      if (task.runnerData) {
        try {
          runnerData = JSON.parse(task.runnerData);
          console.log(`📊 Using runner data for task ${taskId}`);
        } catch (error) {
          console.error(`Failed to parse runner data for task ${taskId}:`, error);
          await this.markTaskAsFailed(taskId);
          return false;
        }
      } else {
        console.log(`📊 No runner data specified for task ${taskId}`);
      }

      // Create and run the TaskRunner using TaskRunnerRegistry
      const { TaskRunnerRegistry } = await import('../types/task.js');
      const success = await TaskRunnerRegistry.runByTaskId(this.prisma, taskId);
      if (!success) {
        console.error(`Failed to run task ${taskId}`);
        await this.markTaskAsFailed(taskId);
        return false;
      }

      // Mark task as completed
      await this.prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      console.log(`✅ Task ${taskId} completed successfully`);
      return true;

    } catch (error) {
      console.error(`❌ Error executing task ${taskId}:`, error);
      await this.markTaskAsFailed(taskId);
      return false;
    }
  }

  /**
   * Execute all ready tasks
   */
  async executeReadyTasks(): Promise<number> {
    const readyTasks = await this.getReadyTasks();
    let executedCount = 0;

    console.log(`Found ${readyTasks.length} ready tasks to execute`);

    for (const task of readyTasks) {
      const success = await this.executeTask(task.id);
      if (success) {
        executedCount++;
      }
    }

    return executedCount;
  }

  /**
   * Get all tasks that are ready to execute
   */
  private async getReadyTasks() {
    return await this.prisma.task.findMany({
      where: {
        status: TaskStatus.PENDING,
        dependencies: {
          every: {
            dependency: {
              status: TaskStatus.COMPLETED,
            },
          },
        },
      },
      include: {
        dependencies: {
          include: {
            dependency: true,
          },
        },
      },
    });
  }

  /**
   * Check if a task is ready to run
   */
  private isTaskReady(task: any): boolean {
    if (task.status !== TaskStatus.PENDING) {
      return false;
    }

    return task.dependencies.every((dep: any) => 
      dep.dependency.status === TaskStatus.COMPLETED
    );
  }

  /**
   * Mark a task as failed
   */
  private async markTaskAsFailed(taskId: number): Promise<void> {
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.CANCELLED },
    });
  }
}
