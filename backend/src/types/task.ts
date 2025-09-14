// Task status enum for type safety
export enum TaskStatus {
  NOT_STARTED = 'NOT_STARTED', // task create in the DB but not yet initiated.
  INITIATED = 'INITIATED', // `initiateTask` has been called. // FIXME: Check that I set into this state.
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

/**
 * Core interface that all task runners must implement.
 * 
 * TaskRunners are responsible for executing specific business logic for tasks in the system.
 * They can be either OpenAI-based runners (that make API calls to OpenAI) or utility runners
 * (that process data from other runners without external API calls).
 * 
 * @interface TaskRunner
 * 
 * @example
 * ```typescript
 * class MyCustomRunner implements TaskRunner {
 *   async initiateTask(taskId: number): Promise<void> {
 *     // Implementation here
 *   }
 * }
 * ```
 * 
 * @see {@link BaseRunner} - Abstract base class providing common functionality
 * @see {@link BaseOpenAIRunner} - Base class for OpenAI-specific runners
 * @see {@link TaskRunnerRegistry} - Registry for managing runner instances
 */
export interface TaskRunner {
  /**
   * Initiates the execution of a task with the given ID.
   * 
   * This is the main entry point for task execution. The method should:
   * - Fetch task data and dependencies from the database
   * - Check if all dependencies are completed
   * - Execute the specific business logic for this runner type
   * - Update the task status and runner data in the database
   * - Handle errors gracefully and provide meaningful error messages
   * 
   * @param taskId - The unique identifier of the task to execute
   * @returns Promise that resolves when task execution is complete
   * 
   * @throws {TaskRunnerError} When task execution fails due to business logic errors
   * @throws {DependencyError} When required dependencies are missing or invalid
   * @throws {Error} When unexpected errors occur during execution
   * 
   * @example
   * ```typescript
   * async initiateTask(taskId: number): Promise<void> {
   *   try {
   *     const task = await this.getTaskWithDependencies(taskId);
   *     await this.executeTask(task);
   *   } catch (error) {
   *     this.log('error', 'Task execution failed', { taskId, error });
   *     throw error;
   *   }
   * }
   * ```
   */
  initiateTask(taskId: number): Promise<void>;
}

// Task runner data interface for type safety
export interface TaskRunnerData {
  [key: string]: any;
}

// Task runner registry for class instantiation (in-memory only)
// Note: TaskRunner metadata (name, className, description) is stored in database via TaskRunnerService
export class TaskRunnerRegistry {
  private static runners: Map<string, new (data: TaskRunnerData, taskId: number) => TaskRunner> = new Map();

  static register(name: string, runnerClass: new (data: TaskRunnerData, taskId: number) => TaskRunner): void {
    this.runners.set(name, runnerClass);
  }

  private static get(name: string): (new (data: TaskRunnerData, taskId: number) => TaskRunner) {
    const result = this.runners.get(name);
    if (result === undefined) {
      throw new Error(`TaskRunner class '${name}' not found in registry`);
    }
    return result;
  }

  private static createRunner(className: string, data: TaskRunnerData, taskId: number): TaskRunner | null {
    const RunnerClass = this.get(className);
    return new RunnerClass(data, taskId);
  }

  // private static getAvailableRunners(): string[] {
  //   return Array.from(this.runners.keys());
  // }

  /**
   * Run a TaskRunner by task ID
   * This method integrates with the database to fetch task information
   */
  static async runByTaskId(
    prisma: any, 
    taskId: number
  ): Promise<boolean> {
    try {
      // Get task information from database
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        console.error(`Task with ID ${taskId} not found in database`);
        return false;
      }

      // Parse runner data
      let runnerData: TaskRunnerData = {};
      if (task.runnerData) {
        try {
          runnerData = JSON.parse(task.runnerData);
        } catch (error) {
          console.error(`Failed to parse runner data for task ${taskId}:`, error);
          return false;
        }
      }

      // Create and run the TaskRunner
      const runnerInstance = this.createRunner(task.runnerClassName, runnerData, taskId);
      if (!runnerInstance) {
        console.error(`Failed to create runner instance for '${task.runnerClassName}'`);
        return false;
      }

      console.log(`🚀 Running TaskRunner: ${task.runnerName || 'Unknown'} (${task.runnerClassName})`);
      await runnerInstance.initiateTask(taskId);
      console.log(`✅ TaskRunner ${task.runnerName || 'Unknown'} completed successfully`);

      return true;
    } catch (error) {
      console.error(`❌ Error running TaskRunner by task ID ${taskId}:`, error);
      return false;
    }
  }

  /**
   * Mark a task as completed by task ID
   * This method updates the task status to COMPLETED and sets the completedAt timestamp
   */
  static async completeTask(
    prisma: any,
    taskId: number,
    output: object
  ): Promise<boolean> {
    // Update the task status to COMPLETED and set data
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        updatedAt: new Date(),
        ...output
      }
    });

    console.log(`✅ Task ${taskId} marked as COMPLETED`);
    return true;
  }

  /**
   * Mark a task as cancelled by task ID
   * This method updates the task status to CANCELLED and sets the cancellation reason
   */
  static async markTaskAsCancelled(
    prisma: any,
    taskId: number,
  ): Promise<boolean> {
    try {
      // Update the task status to CANCELLED and add cancellation info to runnerData
      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CANCELLED,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });

      console.log(`❌ Task ${taskId} marked as CANCELLED`);
      return true;
    } catch (error) {
      console.error(`❌ Error cancelling task ${taskId}:`, error);
      return false;
    }
  }
}
