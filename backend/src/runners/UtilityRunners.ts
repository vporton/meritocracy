import { TaskRunner, TaskRunnerData } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIOutputter } from '../services/openai.js';

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
 * Base class for all TaskRunners with common functionality
 * Provides shared methods for dependency checking and task management
 */
abstract class BaseRunner implements TaskRunner {
  protected readonly data: TaskRunnerData;
  protected readonly prisma: PrismaClient;
  protected readonly runnerName: string;

  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
    this.runnerName = this.constructor.name;
  }

  /**
   * Structured logging utility for consistent log formatting
   * @param level - Log level (info, warn, error)
   * @param message - Log message
   * @param context - Additional context data
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

  shouldCheckCancelledDependencies(): boolean {
    return true;
  }

  /**
   * Main entry point for running a task
   * @param taskId - The ID of the task to run
   * @throws Error if task execution fails
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
   * Get task with dependencies from database
   * @param taskId - The ID of the task to retrieve
   * @returns Promise resolving to task with dependencies
   * @throws Error if task is not found
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
   * Check if all dependencies are completed
   * @param task - The task with dependencies to check
   * @returns True if all dependencies are completed, false otherwise
   */
  protected areDependenciesCompleted(task: TaskWithDependencies): boolean {
    const incompleteDependencies = task.dependencies.filter(dep => 
      dep.dependency.status !== 'COMPLETED'
    );
    return incompleteDependencies.length === 0;
  }

  /**
   * Check if any dependencies are cancelled
   * @param task - The task with dependencies to check
   * @returns True if any dependency is cancelled, false otherwise
   */
  protected areAnyDependenciesCancelled(task: TaskWithDependencies): boolean {
    const cancelledDependencies = task.dependencies.filter(dep => 
      dep.dependency.status === 'CANCELLED'
    );
    return cancelledDependencies.length > 0;
  }

  /**
   * Execute the task - can be overridden for custom logic
   * @param task - The task to execute
   */
  protected abstract executeTask(task: TaskWithDependencies): Promise<void>;

  /**
   * Retrieve OpenAI result from the batch store
   * @param params - Object containing customId and storeId
   * @returns Promise resolving to the parsed OpenAI response
   * @throws Error if no response content is received
   */
  protected async getOpenAIResult({ customId, storeId }: { customId: string; storeId: string }): Promise<any> {
    const store = await createAIBatchStore(storeId);
    const outputter = await createAIOutputter(store);
    
    const response = await outputter.getOutputOrThrow(customId);
    
    // Parse the response content
    const content = (response as any).choices[0]?.message?.content;
    if (!content) {
      throw new OpenAIError('No response content received from OpenAI', customId);
    }
    
    return JSON.parse(content);
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
    
    // Store the result
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETED',
        runnerData: JSON.stringify({
          ...this.data,
          medianWorth: median,
          sourceValues: worthValues,
          completedAt: new Date().toISOString()
        })
      }
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
    
    // Store the result
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        runnerData: JSON.stringify({
          ...this.data,
          worthValue,
          threshold,
          exceedsThreshold,
          completedAt: new Date().toISOString()
        })
      }
    });

    this.log('info', `✅ Worth Threshold Check completed`, { 
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
  const { TaskRunnerRegistry } = require('../types/task.js');
  TaskRunnerRegistry.register('WorthThresholdCheckRunner', WorthThresholdCheckRunner);
  TaskRunnerRegistry.register('MedianRunner', MedianRunner);
}
