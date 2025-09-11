// Task status enum for type safety
export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface TaskRunner {
  initiateTask(taskId: number): Promise<void>;
}

// Task runner data interface for type safety
export interface TaskRunnerData {
  [key: string]: any;
}

// Task runner registry for class instantiation (in-memory only)
// Note: TaskRunner metadata (name, className, description) is stored in database via TaskRunnerService
export class TaskRunnerRegistry {
  private static runners: Map<string, new (data: TaskRunnerData) => TaskRunner> = new Map();

  static register(name: string, runnerClass: new (data: TaskRunnerData) => TaskRunner): void {
    this.runners.set(name, runnerClass);
  }

  private static get(name: string): (new (data: TaskRunnerData) => TaskRunner) {
    const result = this.runners.get(name);
    if (result === undefined) {
      throw new Error(`TaskRunner class '${name}' not found in registry`);
    }
    return result;
  }

  private static createRunner(className: string, data: TaskRunnerData): TaskRunner | null {
    const RunnerClass = this.get(className);
    return new RunnerClass(data);
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
      const runnerInstance = this.createRunner(task.runnerClassName, runnerData);
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
    taskId: number
  ): Promise<boolean> {
    try {
      // Update the task status to COMPLETED and set completedAt timestamp
      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });

      console.log(`✅ Task ${taskId} marked as COMPLETED`);
      return true;
    } catch (error) {
      console.error(`❌ Error completing task ${taskId}:`, error);
      return false;
    }
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
      // Get current task data to preserve existing runnerData
      const currentTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { runnerData: true }
      });

      let updatedRunnerData = {};
      if (currentTask?.runnerData) {
        try {
          updatedRunnerData = JSON.parse(currentTask.runnerData);
        } catch (error) {
          console.warn(`Failed to parse existing runner data for task ${taskId}, using empty object`);
        }
      }

      // Update the task status to CANCELLED and add cancellation info to runnerData
      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CANCELLED,
          runnerData: JSON.stringify({ // FIXME: RunnerData is here but not in `completeTask` - one of the two is an error.
            ...updatedRunnerData,
            cancelledAt: new Date().toISOString()
          }),
          updatedAt: new Date()
        }
      });

      console.log(`❌ Task ${taskId} marked as CANCELLED: ${reason}`);
      return true;
    } catch (error) {
      console.error(`❌ Error cancelling task ${taskId}:`, error);
      return false;
    }
  }
}
