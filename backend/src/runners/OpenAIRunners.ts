import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIRunner, createAIOutputter } from '../services/openai.js';
import { onboardingPrompt, randomizePrompt, worthPrompt, injectionPrompt, scientistCheckSchema, worthAssessmentSchema, promptInjectionSchema, randomizedPromptSchema } from '../prompts.js';
import { v4 as uuidv4 } from 'uuid';

// Constants
const DEFAULT_MODEL = 'gpt-5-nano-2025-08-07';
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_THRESHOLD = 1e-11;
const BAN_DURATION_YEARS = 1;

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

interface OpenAIRequestResult {
  storeId: string;
}

interface ScientistCheckResponse {
  isActiveScientistOrFOSSDev: boolean;
  why: string;
}

interface WorthAssessmentResponse {
  worthAsFractionOfGDP: number;
  why: string;
}

interface PromptInjectionResponse {
  hasPromptInjection: boolean;
  why: string;
}

interface RandomizedPromptResponse {
  randomizedPrompt: string;
}

interface TaskRunnerResult {
  customId: string;
  storeId: string;
  requestInitiated: boolean;
  initiatedAt: string;
  completedAt?: string;
  [key: string]: any;
}


/**
 * Base class for OpenAI TaskRunners with common functionality
 * Provides shared methods for dependency checking, OpenAI requests, and task management
 */
abstract class BaseOpenAIRunner implements TaskRunner {
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

  /**
   * Main entry point for running a task
   * @param taskId - The ID of the task to run
   * @throws Error if task execution fails
   */
  async run(taskId: number): Promise<void> {
    try {
      this.log('info', `🤖 Running OpenAI TaskRunner for task ${taskId}`, { taskId });
      
      // Get task data from database
      const task = await this.getTaskWithDependencies(taskId);

      // Check if all dependencies are completed
      if (!this.areDependenciesCompleted(task)) {
        this.log('info', `⏳ Task has incomplete dependencies, remaining PENDING`, { taskId, dependenciesCount: task.dependencies.length });
        return; // Task remains in PENDING state
      }

      // Execute the specific logic (either OpenAI request or custom processing)
      await this.executeTask(task);
      
      this.log('info', `✅ OpenAI TaskRunner completed for task ${taskId}`, { taskId });
    } catch (error) {
      this.log('error', `❌ Error in OpenAI TaskRunner`, { taskId, error: error instanceof Error ? error.message : String(error) });
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
   * Execute the task - can be overridden for custom logic
   * @param task - The task to execute
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    await this.initiateRequest(task);
  }

  /**
   * Abstract method to initiate the specific request for each runner type
   * @param task - The task to process
   */
  protected abstract initiateRequest(task: TaskWithDependencies): Promise<void>;

  /**
   * Retrieve OpenAI result from the batch store
   * @param params - Object containing customId and storeId
   * @returns Promise resolving to the parsed OpenAI response
   * @throws Error if no response content is received
   */
  public async getOpenAIResult({ customId, storeId }: { customId: string; storeId: string }): Promise<any> {
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

  /**
   * Make an OpenAI request using the `flexible-batches` API
   * @param prompt - The prompt to send to OpenAI
   * @param schema - The JSON schema for response format
   * @param customId - Unique identifier for this request
   * @returns Promise resolving to store ID for result retrieval
   */
  protected async makeOpenAIRequest(
    prompt: string,
    schema: any,
    customId: string,
  ): Promise<OpenAIRequestResult> {
    const store = await createAIBatchStore(undefined);
    const runner = await createAIRunner(store);
    
    // Add the request to the runner
    await runner.addItem({
      custom_id: customId,
      method: "POST",
      body: {
        messages: [
          {
            role: "system" as const,
            content: prompt
          }
        ],
        model: DEFAULT_MODEL,
        temperature: DEFAULT_TEMPERATURE,
        response_format: {
          type: "json_schema" as const,
          json_schema: {
            name: "response",
            schema: schema
          }
        }
      }
    });
    
    // Flush to execute the request
    await runner.flush();
    
    // Return the store ID for later result retrieval
    return { storeId: store.getStoreId() }; // TODO: `storeId` should be stored in the database before flushing?
  }

  /**
   * Common method to update task with runner data after initiating an OpenAI request
   * @param task - The task to update
   * @param customId - Unique identifier for the request
   * @param additionalData - Additional data to include in runner data
   */
  protected async updateTaskWithRequestData(
    task: TaskWithDependencies, 
    customId: string, 
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        runnerData: JSON.stringify({
          ...this.data,
          ...additionalData,
          customId,
          requestInitiated: true,
          initiatedAt: new Date().toISOString()
        })
      }
    });
  }

  /**
   * Common method to initiate an OpenAI request and update task data
   * @param task - The task to process
   * @param prompt - The prompt to send to OpenAI
   * @param schema - The JSON schema for response format
   * @param additionalData - Additional data to include in runner data
   */
  protected async initiateOpenAIRequest(
    task: TaskWithDependencies,
    prompt: string,
    schema: any,
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    const customId = uuidv4();
    // Update database first to ensure consistent state
    await this.updateTaskWithRequestData(task, customId, additionalData);
    // Then initiate the OpenAI request
    await this.makeOpenAIRequest(prompt, schema, customId);
  }


  /**
   * Helper method to get a single dependency result by runner class name
   * @param task - The task with dependencies
   * @param runnerClassName - The class name of the runner to look for
   * @returns The dependency result or null if not found
   */
  protected async getDependencyResult(
    task: TaskWithDependencies, 
    runnerClassName: string
  ): Promise<any> {
    const dependency = task.dependencies.find(dep => 
      dep.dependency.runnerClassName === runnerClassName
    );

    if (!dependency) {
      throw new DependencyError(`${runnerClassName} dependency not found`, undefined, task.id, this.constructor.name);
    }

    const depTask = dependency.dependency;
    if (!depTask.runnerData) {
      throw new DependencyError(`${runnerClassName} dependency has no runner data`, depTask.id, task.id, this.constructor.name);
    }

    const depData: TaskRunnerResult = JSON.parse(depTask.runnerData);
    if (!depData.customId || !depData.storeId) {
      throw new DependencyError(`${runnerClassName} dependency missing customId or storeId`, depTask.id, task.id, this.constructor.name);
    }

    return await this.getOpenAIResult({ 
      customId: depData.customId, 
      storeId: depData.storeId 
    });
  }
}

/**
 * Abstract base class for runners that use randomized prompts from dependencies
 * Provides common functionality for retrieving and using randomized prompts
 */
abstract class RunnerWithRandomizedPrompt extends BaseOpenAIRunner {
  /**
   * Retrieve the randomized prompt from the RandomizePromptRunner dependency
   * @param task - The task with dependencies
   * @returns The randomized prompt string
   * @throws Error if dependency is not found or has invalid data
   */
  protected async getRandomizedPromptFromDependency(task: TaskWithDependencies): Promise<string> {
    const response: RandomizedPromptResponse = await this.getDependencyResult(task, 'RandomizePromptRunner');
    return response.randomizedPrompt;
  }

  /**
   * Abstract method to get the original prompt that should be randomized
   * @returns The original prompt string
   */
  protected abstract getOriginalPrompt(): string;

  /**
   * Abstract method to get the JSON schema for the response
   * @returns The JSON schema object
   */
  protected abstract getResponseSchema(): any;

  /**
   * Initiate the request using a randomized prompt from dependency
   * @param task - The task containing user data and dependencies
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    
    // Get randomized prompt from dependency (randomizePrompt task)
    const randomizedPrompt = await this.getRandomizedPromptFromDependency(task);
    const finalPrompt = randomizedPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, finalPrompt, this.getResponseSchema());
  }
}

/**
 * TaskRunner for checking if a user is an active scientist or FOSS developer
 * Uses OpenAI to analyze user data and determine if they are an active scientist or FOSS developer
 */
export class ScientistOnboardingRunner extends BaseOpenAIRunner {
  /**
   * Initiate the scientist check request
   * @param task - The task containing user data to analyze
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    const prompt = onboardingPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, prompt, scientistCheckSchema);
  }
}

/**
 * TaskRunner for assessing user worth as fraction of GDP using randomized prompts
 * Uses a randomized prompt from a dependency to assess user worth
 * Can optionally depend on WorthThresholdCheckRunner and return undefined if threshold not met
 */
export class WorthAssessmentRunner extends RunnerWithRandomizedPrompt {
  /**
   * Get the original prompt that should be randomized
   * @returns The original worth prompt
   */
  protected getOriginalPrompt(): string {
    return worthPrompt;
  }

  /**
   * Get the JSON schema for the response
   * @returns The worth assessment schema
   */
  protected getResponseSchema(): any {
    return worthAssessmentSchema;
  }

  /**
   * Execute the task with optional threshold check dependency and prompt injection check
   * @param task - The task to execute
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    // First, check if any parent dependency (or their parents) is a PromptInjectionRunner that detected injection
    const hasParentInjectionDetection = await this.checkParentInjectionDetection(task);
    
    if (hasParentInjectionDetection) {
      // If injection detected by parent, return undefined instead of making OpenAI request
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          runnerData: JSON.stringify({
            ...this.data,
            worthAsFractionOfGDP: undefined,
            why: 'Prompt injection detected by parent PromptInjectionRunner task, skipping worth assessment',
            completedAt: new Date().toISOString()
          })
        }
      });

      this.log('info', `✅ Worth Assessment skipped due to parent injection detection`, { 
        taskId: task.id 
      });
      return;
    }

    // Check if this runner depends on WorthThresholdCheckRunner
    const thresholdCheckDep = task.dependencies.find(dep => 
      dep.dependency.runnerClassName === 'WorthThresholdCheckRunner'
    );

    if (thresholdCheckDep) {
      // If we have a threshold check dependency, check its result first
      const thresholdResult = await this.getThresholdCheckResult(thresholdCheckDep.dependency);
      
      if (thresholdResult && !thresholdResult.exceedsThreshold) {
        // If threshold not exceeded, return undefined instead of making OpenAI request
        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            runnerData: JSON.stringify({
              ...this.data,
              worthAsFractionOfGDP: undefined,
              why: 'Threshold not exceeded, skipping assessment',
              completedAt: new Date().toISOString()
            })
          }
        });

        this.log('info', `✅ Worth Assessment skipped due to threshold`, { 
          taskId: task.id, 
          thresholdValue: thresholdResult.worthValue,
          threshold: thresholdResult.threshold
        });
        return;
      }
    }

    // If no injection detected and no threshold dependency or threshold exceeded, proceed with normal OpenAI request
    await this.initiateRequest(task);
  }

  /**
   * Get the threshold check result from a dependency
   * @param thresholdTask - The threshold check task
   * @returns The threshold check result or null if not available
   */
  private async getThresholdCheckResult(thresholdTask: any): Promise<any> {
    if (!thresholdTask.runnerData) {
      return null;
    }

    try {
      const thresholdData = JSON.parse(thresholdTask.runnerData);
      return {
        worthValue: thresholdData.worthValue,
        threshold: thresholdData.threshold,
        exceedsThreshold: thresholdData.exceedsThreshold
      };
    } catch (error) {
      this.log('warn', `Failed to parse threshold check result`, { 
        thresholdTaskId: thresholdTask.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Recursively check if any parent dependency (or their parents) is a PromptInjectionRunner that detected injection
   * @param task - The task to check dependencies for
   * @returns True if any parent PromptInjectionRunner detected injection
   */
  private async checkParentInjectionDetection(task: TaskWithDependencies): Promise<boolean> {
    for (const dep of task.dependencies) {
      const depTask = dep.dependency;
      
      // Check if this dependency is a PromptInjectionRunner
      if (depTask.runnerClassName === 'PromptInjectionRunner') {
        // Check if it's completed and has detected injection
        if (depTask.status === 'COMPLETED' && depTask.runnerData) {
          try {
            const depData = JSON.parse(depTask.runnerData);
            if (depData.hasPromptInjection === true) {
              this.log('info', `Found parent PromptInjectionRunner with injection detection`, { 
                parentTaskId: depTask.id,
                currentTaskId: task.id
              });
              return true;
            }
          } catch (error) {
            this.log('warn', `Failed to parse parent PromptInjectionRunner data`, { 
              parentTaskId: depTask.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Recursively check this dependency's dependencies
      if (depTask.status === 'COMPLETED') {
        const depTaskWithDeps = await this.getTaskWithDependencies(depTask.id);
        const hasNestedInjectionDetection = await this.checkParentInjectionDetection(depTaskWithDeps);
        if (hasNestedInjectionDetection) {
          return true;
        }
      }
    }

    return false;
  }
}


/**
 * TaskRunner for randomizing prompts
 * Takes an original prompt and creates a randomized version while preserving meaning
 */
export class RandomizePromptRunner extends BaseOpenAIRunner {
  /**
   * Initiate the prompt randomization request
   * @param task - The task containing the original prompt to randomize
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    const originalPrompt = this.data.originalPrompt;
    if (!originalPrompt) {
      throw new TaskRunnerError('Original prompt is required for randomization', task.id, this.constructor.name);
    }
    
    const randomizeRequest = randomizePrompt.replace('<PROMPT>', originalPrompt);
    await this.initiateOpenAIRequest(task, randomizeRequest, randomizedPromptSchema);
  }
}

/**
 * TaskRunner for detecting prompt injection using randomized prompts
 * Analyzes user data to detect deliberate prompt injection attempts
 */
export class PromptInjectionRunner extends RunnerWithRandomizedPrompt {
  /**
   * Get the original prompt that should be randomized
   * @returns The original injection prompt
   */
  protected getOriginalPrompt(): string {
    return injectionPrompt;
  }

  /**
   * Get the JSON schema for the response
   * @returns The prompt injection schema
   */
  protected getResponseSchema(): any {
    return promptInjectionSchema;
  }

  /**
   * Execute the task with optimization: skip if parent PromptInjectionRunner already detected injection
   * @param task - The task to execute
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    // Check if any parent dependency (or their parents) is a PromptInjectionRunner that returned true
    const hasParentInjectionDetection = await this.checkParentInjectionDetection(task);
    
    if (hasParentInjectionDetection) {
      // Skip the actual injection check and return true directly
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          runnerData: JSON.stringify({
            ...this.data,
            hasPromptInjection: true,
            why: 'Injection already detected by parent PromptInjectionRunner task',
            completedAt: new Date().toISOString()
          })
        }
      });

      this.log('info', `✅ PromptInjectionRunner skipped - parent already detected injection`, { 
        taskId: task.id 
      });
      return;
    }

    // If no parent detected injection, proceed with normal execution
    await this.initiateRequest(task);
  }

  /**
   * Recursively check if any parent dependency (or their parents) is a PromptInjectionRunner that detected injection
   * @param task - The task to check dependencies for
   * @returns True if any parent PromptInjectionRunner detected injection
   */
  private async checkParentInjectionDetection(task: TaskWithDependencies): Promise<boolean> {
    for (const dep of task.dependencies) {
      const depTask = dep.dependency;
      
      // Check if this dependency is a PromptInjectionRunner
      if (depTask.runnerClassName === 'PromptInjectionRunner') {
        // Check if it's completed and has detected injection
        if (depTask.status === 'COMPLETED' && depTask.runnerData) {
          try {
            const depData = JSON.parse(depTask.runnerData);
            if (depData.hasPromptInjection === true) {
              this.log('info', `Found parent PromptInjectionRunner with injection detection`, { 
                parentTaskId: depTask.id,
                currentTaskId: task.id
              });
              return true;
            }
          } catch (error) {
            this.log('warn', `Failed to parse parent PromptInjectionRunner data`, { 
              parentTaskId: depTask.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Recursively check this dependency's dependencies
      if (depTask.status === 'COMPLETED') {
        const depTaskWithDeps = await this.getTaskWithDependencies(depTask.id);
        const hasNestedInjectionDetection = await this.checkParentInjectionDetection(depTaskWithDeps);
        if (hasNestedInjectionDetection) {
          return true;
        }
      }
    }

    return false;
  }
}

/**
 * TaskRunner for calculating median from dependency results
 * Processes worth assessment results from multiple dependencies and calculates the median
 */
export class MedianRunner extends BaseOpenAIRunner {
  /**
   * No OpenAI request needed - this runner processes dependency results
   * @param task - The task to process
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    // This runner doesn't make OpenAI requests, it processes results from dependencies
    // The actual work is done in executeTask
  }

  /**
   * Execute the median calculation from dependency results
   * @param task - The task with dependencies containing worth assessment results
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    // Extract worth values from dependency results
    const worthValues = await this.processWorthDependencyResults(task);

    if (worthValues.length === 0) {
      throw new DependencyError('No valid worth values found in dependencies', undefined, task.id, this.constructor.name);
    }

    // Calculate median
    const median = this.calculateMedian(worthValues);
    
    // Store the result
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
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
        
        // Check if this is a WorthAssessmentRunner that returned undefined directly
        if (dep.dependency.runnerClassName === 'WorthAssessmentRunner' && 
            depData.worthAsFractionOfGDP !== undefined) {
          // This runner returned undefined (threshold not met), skip it
          this.log('info', `Skipping WorthAssessmentRunner with undefined result (threshold not met)`, { 
            dependencyId: dep.dependency.id 
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
export class WorthThresholdCheckRunner extends BaseOpenAIRunner {
  /**
   * No OpenAI request needed - this runner processes dependency results
   * @param task - The task to process
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    // This runner doesn't make OpenAI requests, it processes results from dependencies
    // The actual work is done in executeTask
  }

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
 * TaskRunner for banning users (when prompt injection is detected)
 * Bans users for a specified duration when prompt injection is detected
 */
export class BanUserRunner extends BaseOpenAIRunner {
  /**
   * No OpenAI request needed - this runner bans users
   * @param task - The task to process
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    // This runner doesn't make OpenAI requests, it bans users
    // The actual work is done in executeTask
  }

  /**
   * Execute the user ban operation
   * @param task - The task containing user ID to ban
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const userId = this.data.userId;
    if (!userId) {
      throw new TaskRunnerError('User ID is required for banning', task.id, this.constructor.name);
    }

    // Ban user for specified duration
    const banUntil = new Date();
    banUntil.setFullYear(banUntil.getFullYear() + BAN_DURATION_YEARS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        bannedTill: banUntil
      }
    });

    // Store the result
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        runnerData: JSON.stringify({
          ...this.data,
          bannedUntil: banUntil.toISOString(),
          reason: 'Prompt injection detected',
          completedAt: new Date().toISOString()
        })
      }
    });

    this.log('info', `✅ User banned`, { 
      userId, 
      bannedUntil: banUntil.toISOString(),
      reason: 'Prompt injection detected'
    });
  }
}

/**
 * Register all OpenAI TaskRunners with the TaskRunnerRegistry
 * This function should be called during application initialization to make all runners available
 */
export function registerOpenAIRunners(): void {
  TaskRunnerRegistry.register('ScientistCheckRunner', ScientistOnboardingRunner);
  TaskRunnerRegistry.register('RandomizePromptRunner', RandomizePromptRunner);
  TaskRunnerRegistry.register('WorthAssessmentRunner', WorthAssessmentRunner);
  TaskRunnerRegistry.register('PromptInjectionRunner', PromptInjectionRunner);
  TaskRunnerRegistry.register('WorthThresholdCheckRunner', WorthThresholdCheckRunner);
  TaskRunnerRegistry.register('MedianRunner', MedianRunner);
  TaskRunnerRegistry.register('BanUserRunner', BanUserRunner);
}
