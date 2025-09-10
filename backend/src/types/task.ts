// Task status enum for type safety
export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

// Helper functions for task management
export class TaskHelper {
  /**
   * Check if a task is ready to start (all dependencies completed)
   */
  static isTaskReady(task: any): boolean {
    if (task.status !== TaskStatus.PENDING) {
      return false;
    }
    
    return task.dependencies.every((dep: any) => 
      dep.dependency.status === TaskStatus.COMPLETED
    );
  }

  /**
   * Get all tasks that are ready to start
   */
  static getReadyTasks(tasks: any[]): any[] {
    return tasks.filter(task => this.isTaskReady(task));
  }
}
