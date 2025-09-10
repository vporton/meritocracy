// Task status enum for type safety
export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface TaskRunner {
  run(): Promise<void>;
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

  static get(name: string): (new (data: TaskRunnerData) => TaskRunner) | undefined {
    return this.runners.get(name);
  }

  static createRunner(className: string, data: TaskRunnerData): TaskRunner | null {
    const RunnerClass = this.get(className);
    if (!RunnerClass) {
      console.error(`TaskRunner class '${className}' not found in registry`);
      return null;
    }
    return new RunnerClass(data);
  }

  static getAvailableRunners(): string[] {
    return Array.from(this.runners.keys());
  }

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

      if (!task.runnerClassName) {
        console.error(`Task ${taskId} has no runner class specified`);
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
      await runnerInstance.run();
      console.log(`✅ TaskRunner ${task.runnerName || 'Unknown'} completed successfully`);

      return true;

    } catch (error) {
      console.error(`❌ Error running TaskRunner by task ID ${taskId}:`, error);
      return false;
    }
  }
}

// Helper functions for task management
export class TaskHelper {
}
