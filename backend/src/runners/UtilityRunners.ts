import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIOutputter } from '../services/openai.js';
import { TaskManager } from '@/services/TaskManager.js';

// Constants
const DEFAULT_THRESHOLD = 1e-11;

// Custom error classes for better error handling
class TaskRunnerError extends Error {
  constructor(message: string, public readonly taskId?: number, public readonly runnerName?: string) {
    super(message);
    this.name = 'TaskRunnerError';
  }
}

class DependencyError extends TaskRunnerError {
  constructor(message: string, public readonly dependencyId?: number, taskId?: number, runnerName?: string) {
    super(message, taskId, runnerName);
    this.name = 'DependencyError';
  }
}

class OpenAIError extends TaskRunnerError {
  constructor(message: string, public readonly customId?: string, taskId?: number, runnerName?: string) {
    super(message, taskId, runnerName);
    this.name = 'OpenAIError';
  }
}

// Type definitions for better type safety
interface TaskWithDependencies {
  id: number;
  status: string;
  runnerData: string | null;
  dependencies: Array<{
    dependency: {
      id: number;
      status: string;
      runnerClassName: string;
      runnerData: string | null;
    };
  }>;
}

interface TaskRunnerResult {
  customId: string;
  storeId: string;
  requestInitiated: boolean;
  initiatedAt: string;
  completedAt?: string;
  [key: string]: any;
}

interface WorthAssessmentResponse {
  worthAsFractionOfGDP: number;
  why: string;
}

/**
 * Abstract base class that provides common functionality for all TaskRunners.
 * 
 * This class implements the core TaskRunner interface and provides shared functionality
 * for dependency management, task execution flow, database operations, and logging.
 * All concrete TaskRunner implementations should extend this class rather than
 * implementing TaskRunner directly.
 * 
 * Key features provided:
 * - Automatic dependency checking and validation
 * - Structured logging with consistent formatting
 * - Database connection management
 * - Task status management
 * - Error handling and propagation
 * - OpenAI result retrieval (for runners that need it)
 * 
 * @abstract
 * @implements {TaskRunner}
 * 
 * @example
 * ```typescript
 * class MyCustomRunner extends BaseRunner {
 *   protected async executeTask(task: TaskWithDependencies): Promise<void> {
 *     // Implement your specific business logic here
 *     // The base class handles dependency checking, logging, etc.
 *   }
 * }
 * ```
 * 
 * @see {@link TaskRunner} - The interface this class implements
 * @see {@link BaseOpenAIRunner} - Extended base class for OpenAI-specific runners
 * 
 * @since 1.0.0
 */
export abstract class BaseRunner implements TaskRunner {
  /**
   * The runner data containing configuration and input parameters for this task.
   * This data is passed from the task creation system and contains all the
   * information needed to execute the specific task logic.
   * 
   * @readonly
   * @protected
   */
  protected readonly data: TaskRunnerData;

  /**
   * Prisma database client instance for database operations.
   * Used for fetching task data, dependencies, and updating task status.
   * 
   * @readonly
   * @protected
   */
  protected readonly prisma: PrismaClient;

  /**
   * The name of the runner class, automatically derived from the constructor name.
   * Used for logging and identification purposes.
   * 
   * @readonly
   * @protected
   */
  protected readonly runnerName: string;

  /**
   * Creates a new BaseRunner instance.
   * 
   * @param data - The runner data containing configuration and input parameters
   * 
   * @example
   * ```typescript
   * const runner = new MyCustomRunner({
   *   userId: 123,
   *   userData: { name: 'John Doe' },
   *   threshold: 0.01
   * });
   * ```
   */
  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
    this.runnerName = this.constructor.name;
  }

  /**
   * Structured logging utility for consistent log formatting across all runners.
   * 
   * Provides standardized logging with timestamps, runner identification, and
   * structured context data. All logs include the runner name and timestamp
   * for easy debugging and monitoring.
   * 
   * @param level - The log level indicating the severity/type of message
   * @param message - The main log message to display
   * @param context - Additional context data to include in the log (optional)
   * 
   * @example
   * ```typescript
   * this.log('info', 'Task execution started', { taskId: 123, userId: 456 });
   * this.log('warn', 'Dependency not found', { dependencyId: 789 });
   * this.log('error', 'Task execution failed', { error: error.message, taskId: 123 });
   * ```
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, context: Record<string, any> = {}): void {
    const logData = {
      timestamp: new Date().toISOString(),
      runner: this.runnerName,
      level,
      message,
      ...context
    };

    switch (level) {
      case 'info':
        console.log(`[${logData.timestamp}] ${logData.runner}: ${message}`, context);
        break;
      case 'warn':
        console.warn(`[${logData.timestamp}] ${logData.runner}: ${message}`, context);
        break;
      case 'error':
        console.error(`[${logData.timestamp}] ${logData.runner}: ${message}`, context);
        break;
    }
  }

  /**
   * Log an OpenAI response to the database
   * @param customId - Unique identifier for this request
   * @param responseData - The response data received from OpenAI
   * @param errorMessage - Optional error message if the request failed
   */
  protected async logOpenAIResponse(
    customId: string,
    responseData?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.prisma.openAILog.update({
        where: { customId },
        data: {
          responseReceived: new Date(),
          responseData: responseData ? JSON.stringify(responseData) : null,
          errorMessage: errorMessage || null
        }
      });
      
      this.log('info', `📝 Logged OpenAI response`, { 
        customId, 
        hasResponse: !!responseData,
        hasError: !!errorMessage
      });
    } catch (error) {
      this.log('error', `Failed to log OpenAI response`, { 
        customId, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Determines whether this runner should check for cancelled dependencies.
   * 
   * By default, runners check if any dependencies are cancelled and will cancel
   * themselves if so. Some runners (like MedianRunner) may override this to
   * process available data even when some dependencies are cancelled.
   * 
   * @returns `true` if cancelled dependencies should be checked (default), `false` otherwise
   * 
   * @example
   * ```typescript
   * // In a runner that should be cancelled if dependencies are cancelled
   * shouldCheckCancelledDependencies(): boolean {
   *   return true; // default behavior
   * }
   * 
   * // In a runner that processes available data regardless of cancelled dependencies
   * shouldCheckCancelledDependencies(): boolean {
   *   return false; // skip cancellation checks
   * }
   * ```
   */
  shouldCheckCancelledDependencies(): boolean {
    return true;
  }

  /**
   * Main entry point for running a task - implements the TaskRunner interface.
   * 
   * This method orchestrates the complete task execution flow:
   * 1. Fetches task data and dependencies from the database
   * 2. Checks if dependencies are completed (unless overridden)
   * 3. Checks if any dependencies are cancelled (unless overridden)
   * 4. Calls the abstract executeTask method for specific business logic
   * 5. Handles errors and provides structured logging
   * 6. Ensures database connection is properly closed
   * 
   * @param taskId - The unique identifier of the task to execute
   * @returns Promise that resolves when task execution is complete
   * 
   * @throws {TaskRunnerError} When task is not found in database
   * @throws {Error} When task execution fails or unexpected errors occur
   * 
   * @example
   * ```typescript
   * const runner = new MyCustomRunner(data);
   * await runner.initiateTask(123); // Executes task with ID 123
   * ```
   * 
   * @see {@link executeTask} - Abstract method that subclasses must implement
   * @see {@link shouldCheckCancelledDependencies} - Controls cancellation checking behavior
   */
  async initiateTask(taskId: number): Promise<void> {
    const runnerType = this.constructor.name;
    const logPrefix = this.shouldCheckCancelledDependencies() ? 'TaskRunner' : `${runnerType} (bypassing cancellation checks)`;
    
    try {
      this.log('info', `🤖 Running ${logPrefix} for task ${taskId}`, { taskId });
      
      // Get task data from database
      const task = await this.getTaskWithDependencies(taskId);

      // Check if any dependencies are cancelled - if so, cancel this task too (unless bypassed)
      if (this.shouldCheckCancelledDependencies() && this.areAnyDependenciesCancelled(task)) {
        const { TaskRunnerRegistry } = await import('../types/task.js');
        await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id);
        return;
      }

      // Check if all dependencies are completed
      if (!this.areDependenciesCompleted(task)) {
        this.log('info', `⏳ Task has incomplete dependencies, remaining PENDING`, { taskId, dependenciesCount: task.dependencies.length });
        return; // Task remains in PENDING state
      }

      // Execute the specific logic
      await this.executeTask(task);
      
      this.log('info', `✅ ${logPrefix} completed for task ${taskId}`, { taskId });
    } catch (error) {
      this.log('error', `❌ Error in ${logPrefix}`, { taskId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Retrieves a task with its dependencies from the database.
   * 
   * Fetches the complete task information including all dependency relationships.
   * This method is used internally by the task execution flow to get the current
   * state of the task and its dependencies before processing.
   * 
   * @param taskId - The unique identifier of the task to retrieve
   * @returns Promise resolving to task object with dependencies included
   * 
   * @throws {TaskRunnerError} When task with the given ID is not found in database
   * 
   * @example
   * ```typescript
   * const task = await this.getTaskWithDependencies(123);
   * console.log(`Task ${task.id} has ${task.dependencies.length} dependencies`);
   * ```
   */
  protected async getTaskWithDependencies(taskId: number): Promise<TaskWithDependencies> {
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
      throw new TaskRunnerError(`Task with ID ${taskId} not found`, taskId, this.constructor.name);
    }

    return task as TaskWithDependencies;
  }

  /**
   * Checks if all dependencies of a task are completed.
   * 
   * Iterates through all task dependencies and verifies that each one has
   * a status of 'COMPLETED'. This is used to determine if a task is ready
   * to be executed or should remain in PENDING state.
   * 
   * @param task - The task object with dependencies to check
   * @returns `true` if all dependencies are completed, `false` if any are not completed
   * 
   * @example
   * ```typescript
   * const task = await this.getTaskWithDependencies(123);
   * if (this.areDependenciesCompleted(task)) {
   *   // All dependencies are done, can proceed with execution
   *   await this.executeTask(task);
   * } else {
   *   // Some dependencies still pending, task remains PENDING
   *   return;
   * }
   * ```
   */
  protected areDependenciesCompleted(task: TaskWithDependencies): boolean {
    const incompleteDependencies = task.dependencies.filter(dep => 
      dep.dependency.status !== 'COMPLETED'
    );
    return incompleteDependencies.length === 0;
  }

  /**
   * Checks if any dependencies of a task are cancelled.
   * 
   * Iterates through all task dependencies and checks if any have a status
   * of 'CANCELLED'. If any dependency is cancelled, this task should also
   * be cancelled (unless shouldCheckCancelledDependencies() returns false).
   * 
   * @param task - The task object with dependencies to check
   * @returns `true` if any dependency is cancelled, `false` if none are cancelled
   * 
   * @example
   * ```typescript
   * const task = await this.getTaskWithDependencies(123);
   * if (this.areAnyDependenciesCancelled(task)) {
   *   // A dependency was cancelled, cancel this task too
   *   await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id);
   *   return;
   * }
   * ```
   */
  protected areAnyDependenciesCancelled(task: TaskWithDependencies): boolean {
    const cancelledDependencies = task.dependencies.filter(dep => 
      dep.dependency.status === 'CANCELLED'
    );
    return cancelledDependencies.length > 0;
  }

  /**
   * Abstract method that subclasses must implement to define their specific business logic.
   * 
   * This method is called by initiateTask() after all dependency checks have passed.
   * Each concrete runner implementation should override this method to implement
   * their specific task execution logic.
   * 
   * @param task - The task object with dependencies that is ready to be executed
   * @returns Promise that resolves when the task-specific logic is complete
   * 
   * @throws {TaskRunnerError} When task-specific business logic fails
   * @throws {DependencyError} When required dependency data is missing or invalid
   * @throws {Error} When unexpected errors occur during execution
   * 
   * @example
   * ```typescript
   * protected async executeTask(task: TaskWithDependencies): Promise<void> {
   *   // Get data from dependencies
   *   const userData = this.data.userData;
   *   
   *   // Perform specific business logic
   *   const result = await this.performCalculation(userData);
   *   
   *   // Update task with results
   *   await this.prisma.task.update({
   *     where: { id: task.id },
   *     data: {
   *       status: 'COMPLETED',
   *       runnerData: JSON.stringify({ result, completedAt: new Date().toISOString() })
   *     }
   *   });
   * }
   * ```
   */
  protected abstract executeTask(task: TaskWithDependencies): Promise<void>;

  /**
   * Retrieves and parses OpenAI results from the batch store.
   * 
   * This method is used by runners that need to access results from OpenAI API calls
   * made by other runners. It connects to the OpenAI batch store, retrieves the
   * response for the given custom ID, and parses the JSON content.
   * 
   * @param params - Object containing the custom ID and store ID for the OpenAI result
   * @param params.customId - The unique identifier used for the OpenAI request
   * @param params.storeId - The store ID where the OpenAI result is stored
   * @returns Promise resolving to the parsed OpenAI response object
   * 
   * @throws {OpenAIError} When no response content is received from OpenAI
   * @throws {Error} When the response cannot be parsed as JSON
   * 
   * @example
   * ```typescript
   * // Get result from a dependency that made an OpenAI call
   * const response = await this.getOpenAIResult({
   *   customId: depData.customId,
   *   storeId: depData.storeId
   * });
   * console.log('OpenAI response:', response);
   * ```
   */
  protected async getOpenAIResult({ customId, storeId }: { customId: string; storeId: string }): Promise<any> {
    const store = await createAIBatchStore(storeId);
    const outputter = await createAIOutputter(store);
    
    try {
      const response = await outputter.getOutputOrThrow(customId);
      
      // Parse the response content
      const content = (response as any).choices[0]?.message?.content;
      if (!content) {
        throw new OpenAIError('No response content received from OpenAI', customId); // FIXME: not handled error
      }
      
      const parsedContent = JSON.parse(content);
      
      // Log the response to the database
      await this.logOpenAIResponse(customId, response, undefined);
      
      return parsedContent;
    } catch (error) {
      // Log the error to the database
      await this.logOpenAIResponse(customId, undefined, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

/**
 * TaskRunner for calculating median from dependency results
 * Processes worth assessment results from multiple dependencies and calculates the median
 * EXCEPTION: This runner is not cancelled if dependencies are cancelled - it processes available data
 */
export class MedianRunner extends BaseRunner {
  shouldCheckCancelledDependencies(): boolean {
    return false;
  }

  /**
   * Execute the median calculation from dependency results
   * @param task - The task with dependencies containing worth assessment results
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    // Extract worth values from dependency results
    const worthValues = await this.processWorthDependencyResults(task);

    // Calculate median
    const median = worthValues.length === 0 ? 0 : this.calculateMedian(worthValues);
    
    // Update User.shareInGDP with the calculated median
    const userId = this.data.userId;
    if (userId) {
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            shareInGDP: median
          }
        });
        
        this.log('info', `📊 Updated User.shareInGDP`, { 
          userId, 
          shareInGDP: median,
          taskId: task.id 
        });
      } catch (error) {
        this.log('error', `Failed to update User.shareInGDP`, { 
          userId, 
          error: error instanceof Error ? error.message : String(error),
          taskId: task.id 
        });
        // Don't throw error - continue with task completion even if user update fails
      }
    } else if (!userId) {
      this.log('warn', `No userId provided, skipping User.shareInGDP update`, { taskId: task.id });
    }
    
    // Store the result
    await TaskRunnerRegistry.completeTask(this.prisma, task.id, {
      medianWorth: median,
      sourceValues: worthValues,
      completedAt: new Date().toISOString()
    });

    this.log('info', `✅ Median TaskRunner completed`, { taskId: task.id, median, sourceValuesCount: worthValues.length });
  }

  /**
   * Process dependency results and extract worth values from WorthAssessmentRunner
   * Handles both COMPLETED and CANCELLED dependencies gracefully
   * @param task - The task with dependencies
   * @returns Array of worth values from dependencies
   */
  private async processWorthDependencyResults(task: TaskWithDependencies): Promise<number[]> {
    const worthValues: number[] = [];
    let completedCount = 0;
    let cancelledCount = 0;
    
    for (const dep of task.dependencies) {
      try {
        // Skip cancelled dependencies - they don't have valid data
        if (dep.dependency.status === 'CANCELLED') {
          cancelledCount++;
          this.log('info', `Skipping cancelled dependency`, { 
            dependencyId: dep.dependency.id,
            runnerClassName: dep.dependency.runnerClassName
          });
          continue;
        }

        // Only process COMPLETED dependencies
        if (dep.dependency.status !== 'COMPLETED') {
          this.log('warn', `Dependency not completed`, { 
            dependencyId: dep.dependency.id,
            status: dep.dependency.status
          });
          continue;
        }

        // Get the dependency task data
        if (!dep.dependency.runnerData) {
          this.log('warn', `Dependency has no runner data`, { dependencyId: dep.dependency.id });
          continue;
        }

        const depData: TaskRunnerResult = JSON.parse(dep.dependency.runnerData);
        
        // Check if this is a WorthAssessmentRunner that returned undefined directly
        if (dep.dependency.runnerClassName === 'WorthAssessmentRunner' && 
            depData.worthAsFractionOfGDP === undefined) {
          // This runner returned undefined (threshold not met or injection detected), skip it
          this.log('info', `Skipping WorthAssessmentRunner with undefined result`, { 
            dependencyId: dep.dependency.id,
            reason: depData.why || 'Unknown reason'
          });
          continue;
        }
        
        if (!depData.customId || !depData.storeId) {
          this.log('warn', `Dependency missing customId or storeId`, { dependencyId: dep.dependency.id });
          continue;
        }

        // Get the result from the dependency
        const response: WorthAssessmentResponse = await this.getOpenAIResult({ 
          customId: depData.customId, 
          storeId: depData.storeId 
        });

        if (typeof response.worthAsFractionOfGDP === 'number') {
          worthValues.push(response.worthAsFractionOfGDP);
          completedCount++;
        }
      } catch (error) {
        this.log('warn', `Failed to retrieve dependency result`, { 
          dependencyId: dep.dependency.id, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    this.log('info', `Processed dependencies for median calculation`, {
      totalDependencies: task.dependencies.length,
      completedCount,
      cancelledCount,
      validWorthValues: worthValues.length
    });

    return worthValues;
  }

  /**
   * Calculate the median value from an array of numbers
   * @param values - Array of numbers to calculate median from
   * @returns The median value
   */
  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }
}

/**
 * TaskRunner for checking if worth exceeds threshold
 * Compares a worth assessment result against a configurable threshold
 */
export class WorthThresholdCheckRunner extends BaseRunner {
  /**
   * Execute the threshold check from dependency results
   * @param task - The task with dependencies containing worth assessment results
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const threshold = this.data.threshold || DEFAULT_THRESHOLD;
    
    // Get worth values from dependencies
    const worthValues = await this.processWorthDependencyResults(task);
    
    if (worthValues.length === 0) {
      throw new DependencyError('No valid worth value found in dependencies', undefined, task.id, this.constructor.name);
    }

    // Use the first worth value for threshold comparison
    const worthValue = worthValues[0];
    const exceedsThreshold = worthValue > threshold;
    
    if (!exceedsThreshold) {
      // If threshold not exceeded, mark task as CANCELLED
      const { TaskRunnerRegistry } = await import('../types/task.js');
      await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id);
      
      this.log('info', `🚫 Worth Threshold Check cancelled - threshold not exceeded`, { 
        taskId: task.id, 
        worthValue, 
        threshold
      });
      return;
    }
    
    // Store the result
    await TaskRunnerRegistry.completeTask(this.prisma, task.id, {
      worthValue, 
      threshold, 
      exceedsThreshold 
    });

    this.log('info', `✅ Worth Threshold Check completed - threshold exceeded`, { 
      taskId: task.id, 
      worthValue, 
      threshold, 
      exceedsThreshold 
    });
  }

  /**
   * Process dependency results and extract worth values from WorthAssessmentRunner
   * @param task - The task with dependencies
   * @returns Array of worth values from dependencies
   */
  private async processWorthDependencyResults(task: TaskWithDependencies): Promise<number[]> {
    const worthValues: number[] = [];
    
    for (const dep of task.dependencies) {
      try {
        // Get the dependency task data
        if (!dep.dependency.runnerData) {
          this.log('warn', `Dependency has no runner data`, { dependencyId: dep.dependency.id });
          continue;
        }

        const depData: TaskRunnerResult = JSON.parse(dep.dependency.runnerData);
        if (!depData.customId || !depData.storeId) {
          this.log('warn', `Dependency missing customId or storeId`, { dependencyId: dep.dependency.id });
          continue;
        }

        // Get the result from the dependency
        const response: WorthAssessmentResponse = await this.getOpenAIResult({ 
          customId: depData.customId, 
          storeId: depData.storeId 
        });

        if (typeof response.worthAsFractionOfGDP === 'number') {
          worthValues.push(response.worthAsFractionOfGDP);
        }
      } catch (error) {
        this.log('warn', `Failed to retrieve dependency result`, { 
          dependencyId: dep.dependency.id, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    return worthValues;
  }
}

/**
 * Register all Utility TaskRunners with the TaskRunnerRegistry
 * This function should be called during application initialization to make all utility runners available
 */
export function registerUtilityRunners(): void {
  TaskRunnerRegistry.register('WorthThresholdCheckRunner', WorthThresholdCheckRunner);
  TaskRunnerRegistry.register('MedianRunner', MedianRunner);
}
