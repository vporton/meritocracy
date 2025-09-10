// Task status constants for type safety
export const TASK_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
} as const;

export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];

// Helper functions for task management
export class TaskHelper {
  /**
   * Check if a task is ready to start (all dependencies completed)
   */
  static isTaskReady(task: any): boolean {
    if (task.status !== TASK_STATUS.PENDING) {
      return false;
    }
    
    return task.dependencies.every((dep: any) => 
      dep.dependency.status === TASK_STATUS.COMPLETED
    );
  }

  /**
   * Get all tasks that are ready to start
   */
  static getReadyTasks(tasks: any[]): any[] {
    return tasks.filter(task => this.isTaskReady(task));
  }

  /**
   * Check if there are any circular dependencies
   */
  static hasCircularDependency(taskId: number, dependencyId: number, visited: Set<number> = new Set()): boolean {
    if (visited.has(taskId)) {
      return true;
    }
    
    visited.add(taskId);
    
    // This would need to be implemented with actual database queries
    // to check the full dependency chain
    return false;
  }

}
