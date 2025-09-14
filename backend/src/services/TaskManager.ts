import { PrismaClient } from '@prisma/client';
import { TaskStatus, TaskRunnerRegistry } from '../types/task.js';

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

      if (task.status === TaskStatus.IN_PROGRESS) {
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

      // Update task status to IN_PROGRESS
      await this.prisma.task.update({
        where: { id: taskId },
        data: { 
          status: TaskStatus.IN_PROGRESS,
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
   * Try to run all PENDING tasks using the runTaskWithDependencies function
   * @returns Promise<{ executed: number, failed: number, skipped: number }> - Summary of execution results
   */
  async runAllPendingTasks(): Promise<{ executed: number; failed: number; skipped: number }> {
    // FIXME: The below would run repeatedly for the same task, what is correct for non-batch and wrong for batch mode!
    try {
      let executed = 0;
      let failed = 0;
      let skipped = 0;

      // Loop while there are tasks that can be run
      while (true) {
        // Build a list of tasks that depend only on COMPLETED or CANCELLED tasks
        // TODO: Probably should not keep the entire list in memory.
        const runnableTasks = await this.prisma.task.findMany({
          where: { 
            status: TaskStatus.PENDING,
            dependencies: {
              every: {
                dependency: {
                  status: {
                    in: [TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.IN_PROGRESS]
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

        // Run all tasks in the current batch
        for (const task of runnableTasks) {
          console.log(`Processing task ${task.id}...`);
          
          const success = await this.runTaskWithDependencies(task.id);
          
          if (success) {
            executed++;
          } else {
            // Check if it was skipped due to dependencies or failed
            const currentTask = await this.prisma.task.findUnique({
              where: { id: task.id },
              include: {
                dependencies: {
                  include: {
                    dependency: true,
                  },
                },
              },
            });

            if (currentTask?.status === TaskStatus.PENDING) {
              // Still pending means dependencies weren't met
              skipped++;
              console.log(`Task ${task.id} skipped - dependencies not met`);
            } else {
              // Status changed to CANCELLED means it failed
              failed++;
              console.log(`Task ${task.id} failed to execute`);
            }
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
