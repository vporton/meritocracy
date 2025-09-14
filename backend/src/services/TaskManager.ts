import { PrismaClient } from '@prisma/client';
import { TaskStatus, TaskRunnerRegistry } from '../types/task.js';
import { TaskExecutor } from './TaskExecutor.js';

export class TaskManager {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Run a task with a given taskId only if all tasks on which it depends are COMPLETED
   * @param taskId - The ID of the task to run
   * @returns Promise<boolean> - True if the task was successfully run, false otherwise
   */
  private async runTaskWithDependencies(taskId: number): Promise<boolean> {
    try {
      // Get the task with its dependencies
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

      // Check if task is already completed or in progress
      if (task.status === TaskStatus.COMPLETED) {
        console.log(`Task ${taskId} is already completed`);
        return true;
      }

      if (task.status === TaskStatus.INITIATED) {
        console.log(`Task ${taskId} is already in progress`);
        return false;
      }

      if (task.status === TaskStatus.CANCELLED) {
        console.log(`Task ${taskId} is cancelled and cannot be run`);
        return false;
      }

      // Check if all dependencies are completed
      const incompleteDependencies = task.dependencies.filter(
        (dep) => dep.dependency.status !== TaskStatus.COMPLETED
      );

      if (incompleteDependencies.length > 0) {
        const incompleteIds = incompleteDependencies.map(dep => dep.dependency.id);
        console.log(`Task ${taskId} cannot be run - dependencies not completed: ${incompleteIds.join(', ')}`);
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
        data: { 
          status: TaskStatus.INITIATED,
          updatedAt: new Date()
        },
      });

      console.log(`🚀 Running task ${taskId} with runner: ${task.runnerClassName}`);

      // Run the task using TaskRunnerRegistry
      const success = await TaskRunnerRegistry.runByTaskId(this.prisma, taskId);
      // TODO
      return success; // TODO: What does the return value of this function mean?
    } catch (error) {
      console.error(`❌ Error running task ${taskId}:`, error);
      
      TaskRunnerRegistry.markTaskAsCancelled(this.prisma, taskId);
      
      return false;
    }
  }

  /**
   * Run all pending tasks following the algorithm:
   * - In a loop, while no more tasks status changed:
   *   - for each task, only if the status of its dependencies is COMPLETE or CANCELLED
   *     - If the task is PENDING (NOT_STARTED), initiate it
   *     - If the status is INITIATED, check task output
   * @returns Promise<{ executed: number, failed: number, skipped: number }> - Summary of execution results
   */
  async runAllPendingTasks(): Promise<{ executed: number; failed: number; skipped: number }> {
    try {
      let executed = 0;
      let failed = 0;
      let skipped = 0;

      // Loop while task status changes occur
      let statusChanged = true;
      while (statusChanged) {
        statusChanged = false;

        // Build a list of tasks that depend only on COMPLETED or CANCELLED tasks
        const runnableTasks = await this.prisma.task.findMany({
          where: { 
            status: {
              in: [TaskStatus.NOT_STARTED, TaskStatus.INITIATED]
            },
            dependencies: {
              every: {
                dependency: {
                  status: {
                    in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
                  }
                }
              }
            }
          },
          include: {
            dependencies: {
              include: {
                dependency: true,
              },
            },
          },
          orderBy: { id: 'asc' }, // Process in order of creation
        });

        // If no runnable tasks found, exit the loop
        if (runnableTasks.length === 0) {
          console.log('No more runnable tasks found');
          break;
        }

        console.log(`Found ${runnableTasks.length} runnable tasks to process in this iteration`);

        // Process all tasks in the current batch
        for (const task of runnableTasks) {
          console.log(`Processing task ${task.id} (status: ${task.status})...`);
          
          let taskStatusChanged = false;
          
          if (task.status === TaskStatus.NOT_STARTED) {
            // If the task is PENDING (NOT_STARTED), initiate it
            const success = await this.runTaskWithDependencies(task.id);
            taskStatusChanged = success;
            
            if (success) {
              executed++;
              console.log(`Task ${task.id} initiated successfully`);
            } else {
              // Check if it was skipped due to dependencies or failed
              const currentTask = await this.prisma.task.findUnique({
                where: { id: task.id },
                select: { status: true }
              });

              if (currentTask?.status === TaskStatus.NOT_STARTED) {
                // Still pending means dependencies weren't met
                skipped++;
                console.log(`Task ${task.id} skipped - dependencies not met`);
              } else {
                // Status changed to CANCELLED means it failed
                failed++;
                console.log(`Task ${task.id} failed to execute`);
                taskStatusChanged = true;
              }
            }
          } else if (task.status === TaskStatus.INITIATED) {
            // If the status is INITIATED, check task output
            // const outputChecked = await this.checkTaskOutput(task.id);
            // taskStatusChanged = outputChecked;
            
            // Execute non-batch mode tasks if applicable
            const taskExecutor = new TaskExecutor(this.prisma);
            const executedNonBatch = await taskExecutor.executeNonBatchMode(task.id);
            taskStatusChanged ||= executedNonBatch;

            if (executedNonBatch) {
              executed++; // TODO: Seems to calculate wrongly.
              console.log(`Task ${task.id} output checked and completed`);
            } else {
              // Check if task was cancelled or failed during output checking
              const currentTask = await this.prisma.task.findUnique({
                where: { id: task.id },
                select: { status: true }
              });

              if (currentTask?.status === TaskStatus.CANCELLED) {
                failed++;
                console.log(`Task ${task.id} failed during output check`);
                taskStatusChanged = true;
              }
            }
          }
          
          // Track if any task status changed in this iteration
          if (taskStatusChanged) {
            statusChanged = true;
          }
        }
      }

      console.log(`Task execution summary: ${executed} executed, ${failed} failed, ${skipped} skipped`);
      return { executed, failed, skipped };

    } catch (error) {
      console.error('❌ Error running all pending tasks:', error);
      return { executed: 0, failed: 0, skipped: 0 };
    }
  }

  /**
   * Check the output of an INITIATED task and update its status accordingly
   * @param taskId - The ID of the task to check
   * @returns Promise<boolean> - True if the task status was changed, false otherwise
   */
  private async checkTaskOutput(taskId: number): Promise<boolean> {
    try {
      // Get the task with its current data
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        console.error(`Task with ID ${taskId} not found during output check`);
        return false;
      }

      if (task.status !== TaskStatus.INITIATED) {
        console.log(`Task ${taskId} is not in INITIATED status (current: ${task.status})`);
        return false;
      }

      // Check if task has a runner specified
      if (!task.runnerClassName) {
        console.error(`Task ${taskId} has no runner class specified during output check`);
        await this.prisma.task.update({
          where: { id: taskId },
          data: { 
            status: TaskStatus.CANCELLED,
            updatedAt: new Date()
          },
        });
        return true;
      }

      // Check if task has runner data with output information
      if (!task.runnerData) {
        console.log(`Task ${taskId} has no runner data yet, skipping output check`);
        return false;
      }

      let runnerData;
      try {
        runnerData = JSON.parse(task.runnerData);
      } catch (error) {
        console.error(`Failed to parse runner data for task ${taskId}:`, error);
        await this.prisma.task.update({
          where: { id: taskId },
          data: { 
            status: TaskStatus.CANCELLED,
            updatedAt: new Date()
          },
        });
        return true;
      }

      // Check if the task has a customId and storeId (indicating it made an OpenAI request)
      if (runnerData.customId && runnerData.storeId) {
        console.log(`Checking output for task ${taskId} with customId: ${runnerData.customId}`);
        
        // Create a temporary runner instance to check the output
        const { TaskRunnerRegistry } = await import('../types/task.js');
        
        // Get the runner class and create an instance
        const RunnerClass = TaskRunnerRegistry.getRunnerClass(task.runnerClassName);
        const runnerInstance = new RunnerClass(runnerData, taskId);
        
        try {
          // Check if the output is available and process it
          const output = await (runnerInstance as any).getOutput(runnerData.customId);
          
          if (output !== undefined) {
            console.log(`✅ Task ${taskId} output retrieved and processed successfully`);
            return true; // Status was changed by the runner's onOutput method
          } else {
            console.log(`Task ${taskId} output not yet available`);
            return false;
          }
        } catch (error) {
          console.error(`Error checking output for task ${taskId}:`, error);
          // The runner's error handling should have already updated the task status
          return true; // Assume status was changed due to error
        }
      } else {
        // Task doesn't have OpenAI request data, check if it's a utility runner that should be completed
        console.log(`Task ${taskId} appears to be a utility runner without OpenAI request data`);
        
        // For utility runners, if they're in INITIATED state and have runner data,
        // they should have been completed by their executeTask method
        // Check if they have completion data
        if (runnerData.completedAt || runnerData.status === 'COMPLETED') {
          console.log(`Task ${taskId} already has completion data, updating status`);
          await this.prisma.task.update({
            where: { id: taskId },
            data: { 
              status: TaskStatus.COMPLETED,
              completedAt: new Date(),
              updatedAt: new Date()
            },
          });
          return true;
        }
        
        console.log(`Task ${taskId} is still processing, no output check needed yet`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Error checking task output for task ${taskId}:`, error);
      
      // Mark task as cancelled due to error
      try {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { 
            status: TaskStatus.CANCELLED,
            updatedAt: new Date()
          },
        });
        return true;
      } catch (updateError) {
        console.error(`Failed to update task ${taskId} status after error:`, updateError);
        return false;
      }
    }
  }

  /**
   * Delete all COMPLETED or CANCELLED tasks that are dependencies only of COMPLETED or CANCELLED tasks
   * @returns Promise<number> - Number of tasks deleted
   */
  async deleteOrphanedDependencies(): Promise<number> {
    try {
      // Find all tasks where all dependents are COMPLETED or CANCELLED
      // This uses a single efficient Prisma query instead of multiple queries
      const orphanedTasks = await this.prisma.task.findMany({
        where: {
          status: {
            in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
          },
          dependents: {
            every: {
              task: {
                status: {
                  in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED]
                }
              }
            }
          }
        },
        select: {
          id: true
        }
      });

      const orphanedTaskIds = orphanedTasks.map(task => task.id);

      if (orphanedTaskIds.length === 0) {
        console.log('No orphaned dependency tasks found');
        return 0;
      }

      console.log(`Found ${orphanedTaskIds.length} orphaned dependency tasks to delete: ${orphanedTaskIds.join(', ')}`);

      // Delete the orphaned tasks
      // Note: Due to cascade delete, this will also remove the TaskDependency records
      const deleteResult = await this.prisma.task.deleteMany({
        where: {
          id: { in: orphanedTaskIds },
        },
      });

      console.log(`✅ Deleted ${deleteResult.count} orphaned dependency tasks`);
      return deleteResult.count;

    } catch (error) {
      console.error('❌ Error deleting orphaned dependencies:', error);
      return 0;
    }
  }
}
