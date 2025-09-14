import { PrismaClient, Task, } from '@prisma/client';
import { TaskStatus, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { createAIBatchStore, createAIOutputter, createAIRunner } from './openai.js';
import { BaseOpenAIRunner } from '@/runners/OpenAIRunners.js';

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

      // Update task status to INITIATED
      await this.prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.INITIATED },
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
        status: TaskStatus.NOT_STARTED,
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
    if (task.status !== TaskStatus.NOT_STARTED) {
      return false;
    }

    return task.dependencies.every((dep: any) => 
      dep.dependency.status !== TaskStatus.NOT_STARTED
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
   * Execute non-batch mode task and process its outputs
   * This function handles the execution of tasks when OPENAI_FLEX_MODE is set to 'nonbatch'
   * @return true if we executed at least one task.
   */
  async executeNonBatchMode(taskId: number): Promise<boolean> {
    const openAIFlexMode = process.env.OPENAI_FLEX_MODE as 'batch' | 'nonbatch';
    
    if (openAIFlexMode !== 'nonbatch') {
      console.log(`📋 OPENAI_FLEX_MODE is batch, tasks queued for batch processing`);
      return false;
    }

    let executed = false;
    const task = await this.prisma.task.findUniqueOrThrow({ // TODO: Avoid repeated database queries.
      where: { id: taskId },
      select: {
        storeId: true,
        NonBatches: {
          include: {
            nonbatchMappings: true,
          },
        },
      },
    });
    for (const nonBatch of task.NonBatches) { // TODO: `any` is a hack.
      for (const mapping of nonBatch.nonbatchMappings) {
        const store = await createAIBatchStore(task.storeId!, taskId); // TODO: Fix race conditions in cron runs, may have undefined `storeId`?
        const outputter = await createAIOutputter(store);
        const runner = (await createAIRunner(store)) as unknown as BaseOpenAIRunner; // FIXME: This object here is inappropriate.
        const output = await outputter.getOutput(mapping.customId); // Query output to warrant that the task fully ran.
        if (output === undefined) {
          await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, taskId);
        } else {
          const output2 = runner.extractOutput ? await runner.extractOutput(output) : output; // FIXME: This is a hack.
          await TaskRunnerRegistry.completeTask(this.prisma, taskId, output2);
          executed = true;
        }
      }
    }

    return executed;
  }
}
