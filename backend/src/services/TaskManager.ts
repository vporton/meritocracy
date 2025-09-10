import { PrismaClient } from '@prisma/client';
import { TaskStatus, TaskRunnerRegistry } from '../types/task';

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
  async runTaskWithDependencies(taskId: number): Promise<boolean> {
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
      
      if (success) {
        // Mark task as completed
        await TaskRunnerRegistry.completeTask(this.prisma, taskId);
        console.log(`✅ Task ${taskId} completed successfully`);
        return true;
      } else {
        // Mark task as cancelled if it failed
        await this.prisma.task.update({
          where: { id: taskId },
          data: { 
            status: TaskStatus.CANCELLED,
            updatedAt: new Date()
          },
        });
        console.error(`❌ Task ${taskId} failed to run`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Error running task ${taskId}:`, error);
      
      // Mark task as cancelled on error
      try {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { 
            status: TaskStatus.CANCELLED,
            updatedAt: new Date()
          },
        });
      } catch (updateError) {
        console.error(`Failed to update task ${taskId} status after error:`, updateError);
      }
      
      return false;
    }
  }

  /**
   * Try to run all PENDING tasks using the runTaskWithDependencies function
   * @returns Promise<{ executed: number, failed: number, skipped: number }> - Summary of execution results
   */
  async runAllPendingTasks(): Promise<{ executed: number; failed: number; skipped: number }> {
    try {
      // Get all pending tasks
      const pendingTasks = await this.prisma.task.findMany({
        where: { status: TaskStatus.PENDING },
        include: {
          dependencies: {
            include: {
              dependency: true,
            },
          },
        },
        orderBy: { id: 'asc' }, // Process in order of creation
      });

      console.log(`Found ${pendingTasks.length} pending tasks to process`);

      let executed = 0;
      let failed = 0;
      let skipped = 0;

      // Process each pending task
      for (const task of pendingTasks) {
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

      console.log(`Task execution summary: ${executed} executed, ${failed} failed, ${skipped} skipped`);
      return { executed, failed, skipped };

    } catch (error) {
      console.error('❌ Error running all pending tasks:', error);
      return { executed: 0, failed: 0, skipped: 0 };
    }
  }

  /**
   * Delete all tasks that are dependencies only of COMPLETED tasks
   * @returns Promise<number> - Number of tasks deleted
   */
  async deleteOrphanedDependencies(): Promise<number> {
    try {
      // Find all tasks that are dependencies of other tasks
      const dependencyTasks = await this.prisma.taskDependency.findMany({
        include: {
          dependency: true,
          task: true,
        },
      });

      // Group dependencies by dependency ID
      const dependencyMap = new Map<number, Array<{ taskId: number; status: string }>>();
      
      for (const dep of dependencyTasks) {
        if (!dependencyMap.has(dep.dependencyId)) {
          dependencyMap.set(dep.dependencyId, []);
        }
        dependencyMap.get(dep.dependencyId)!.push({
          taskId: dep.taskId,
          status: dep.task.status,
        });
      }

      // Find tasks that are only dependencies of COMPLETED tasks
      const orphanedTaskIds: number[] = [];
      
      for (const [dependencyId, dependents] of dependencyMap) {
        // Check if all dependent tasks are COMPLETED
        const allDependentsCompleted = dependents.every(
          (dependent) => dependent.status === TaskStatus.COMPLETED
        );

        if (allDependentsCompleted && dependents.length > 0) {
          // Check if the dependency task itself is COMPLETED
          const dependencyTask = await this.prisma.task.findUnique({
            where: { id: dependencyId },
          });

          if (dependencyTask && dependencyTask.status === TaskStatus.COMPLETED) {
            orphanedTaskIds.push(dependencyId);
          }
        }
      }

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

  /**
   * Get a summary of task statuses
   * @returns Promise<object> - Summary of task counts by status
   */
  async getTaskSummary(): Promise<{
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    total: number;
  }> {
    const [pending, inProgress, completed, cancelled, total] = await Promise.all([
      this.prisma.task.count({ where: { status: TaskStatus.PENDING } }),
      this.prisma.task.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.prisma.task.count({ where: { status: TaskStatus.COMPLETED } }),
      this.prisma.task.count({ where: { status: TaskStatus.CANCELLED } }),
      this.prisma.task.count(),
    ]);

    return { pending, inProgress, completed, cancelled, total };
  }

  /**
   * Get tasks with their dependency information
   * @param status - Optional status filter
   * @returns Promise<Array> - Tasks with dependency information
   */
//   async getTasksWithDependencies(status?: TaskStatus) {
//     const whereClause = status ? { status } : {};
    
//     return await this.prisma.task.findMany({
//       where: whereClause,
//       include: {
//         dependencies: {
//           include: {
//             dependency: true,
//           },
//         },
//         dependents: {
//           include: {
//             task: true,
//           },
//         },
//       },
//       orderBy: { id: 'asc' },
//     });
//   }
}
