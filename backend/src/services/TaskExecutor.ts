import { PrismaClient } from '@prisma/client';
import { TaskStatus, TaskRunnerData } from '../types/task.js';
import { createAIBatchStore, createAIOutputter } from './openai.js';

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
      dep.dependency.status !== TaskStatus.PENDING
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

  /**
   * Execute non-batch mode tasks and process their outputs
   * This function handles the execution of tasks when OPENAI_FLEX_MODE is set to 'nonbatch'
   */
  async executeNonBatchMode(rootTaskId: number | null): Promise<boolean> {
    const openAIFlexMode = process.env.OPENAI_FLEX_MODE as 'batch' | 'nonbatch';
    
    if (openAIFlexMode !== 'nonbatch' || !rootTaskId) {
      console.log(`📋 OPENAI_FLEX_MODE is batch, task ${rootTaskId} queued for batch processing`);
      return false;
    }

    console.log(`🚀 OPENAI_FLEX_MODE is non-batch, running task ${rootTaskId} with dependencies`);
    
    const success = await this.executeReadyTasks();
    
    if (success) {
      console.log(`✅ Task ${rootTaskId} executed successfully`);
    } else {
      console.log(`⚠️ Task ${rootTaskId} execution failed or was skipped`);
    }

    // Process all non-batch tasks and their outputs
    const tasks = await this.prisma.task.findMany({
      include: {
        NonBatches: {
          include: { nonbatchMappings: true }
        }
      },
      where: {
        status: { notIn: ['COMPLETED', 'CANCELLED'] }
      }
    });

    for (const task of tasks) {
      for (const nonBatch of task.NonBatches) {
        for (const mapping of nonBatch.nonbatchMappings) {
          const store = await createAIBatchStore(task.storeId!, task.id); // TODO: Fix race conditions in cron runs, may have undefined `storeId`?
          const outputter = await createAIOutputter(store);
          await outputter.getOutput(mapping.customId); // Query output to warrant that the task fully ran.
        }
      }
    }

    return true;
  }
}
