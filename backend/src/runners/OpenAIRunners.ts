import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIRunner, createAIOutputter } from '../services/openai.js';
import { onboardingPrompt, randomizePrompt, worthPrompt, injectionPrompt, scientistCheckSchema, worthAssessmentSchema, promptInjectionSchema, randomizedPromptSchema } from '../prompts.js';
import { v4 as uuidv4 } from 'uuid';
import { ResponseCreateParams, ResponseCreateParamsNonStreaming, Tool, ToolChoiceOptions } from 'openai/resources/responses/responses';
import { ReasoningEffort } from 'openai/resources';

// Constants
const DEFAULT_MODEL = process.env.OPENAI_MODEL!;
const OVERRIDE_REASONING_EFFORT = process.env.OPENAI_OVERRIDE_REASONING_EFFORT ?
  process.env.OPENAI_OVERRIDE_REASONING_EFFORT as ReasoningEffort : undefined;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_THRESHOLD = 1e-11;
const BAN_DURATION_YEARS = 1;

const USE_WEB_SEARCH_TOOL = {
  tools: <Tool[]>[
    {
      name: "web_search",
      type: "function",
      strict: true,
      description: "Search the web for information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" }
        },
        required: ["query"]
      }
    }
  ],
  tool_choice: <ToolChoiceOptions>'required',
};

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
    const logPrefix = this.shouldCheckCancelledDependencies() ? 'OpenAI TaskRunner' : `${runnerType} (bypassing cancellation checks)`;
    
    try {
      this.log('info', `🤖 Running ${logPrefix} for task ${taskId}`, { taskId });
      
      // Get task data from database
      const task = await this.getTaskWithDependencies(taskId);

      // Check if any dependencies are cancelled - if so, cancel this task too (unless bypassed)
      if (this.shouldCheckCancelledDependencies() && this.areAnyDependenciesCancelled(task)) {
        await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id, 'Dependency was cancelled');
        return;
      }

      // Check if all dependencies are completed
      if (!this.areDependenciesCompleted(task)) {
        this.log('info', `⏳ Task has incomplete dependencies, remaining PENDING`, { taskId, dependenciesCount: task.dependencies.length });
        return; // Task remains in PENDING state
      }

      // Execute the specific logic (either OpenAI request or custom processing)
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

    // TaskRunnerRegistry.completeTask(this.prisma, taskId); // FIXME: Where to get `taskId`?
    
    return JSON.parse(content);
  }

}

/**
 * Base class for OpenAI TaskRunners with OpenAI-specific functionality
 * Extends BaseRunner with OpenAI request capabilities
 */
abstract class BaseOpenAIRunner extends BaseRunner {
  protected getModelOptions(): ResponseCreateParams | undefined {
    return undefined;
  }

  protected useWebSearchTool(): boolean {
    return false;
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
    options: ResponseCreateParams = {}
  ): Promise<OpenAIRequestResult> {
    const store = await createAIBatchStore(undefined);
    const runner = await createAIRunner(store);
    
    // Add the request to the runner
    await runner.addItem({
      custom_id: customId,
      method: "POST",
      body: <ResponseCreateParamsNonStreaming>{
        instructions: prompt, // system/developer message.
        // input: TODO, // user's message
        model: options?.model ?? DEFAULT_MODEL,
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
        // include: ['web_search_call.action.sources'], // FIXME: doesn't work due to https://github.com/openai/openai-node/issues/1645
        reasoning: options?.reasoning === null ? null : {
          effort: OVERRIDE_REASONING_EFFORT ?? options?.reasoning?.effort ?? 'medium'
        },
        ...(this.useWebSearchTool() ? USE_WEB_SEARCH_TOOL : {}),
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
    options: ResponseCreateParams = {},
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    const customId = uuidv4();
    // Update database first to ensure consistent state
    await this.updateTaskWithRequestData(task, customId, additionalData);
    // Then initiate the OpenAI request
    await this.makeOpenAIRequest(prompt, schema, customId, options);
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
    
    await this.initiateOpenAIRequest(task, finalPrompt, this.getResponseSchema(), this.getModelOptions());
  }
}

/**
 * TaskRunner for checking if a user is an active scientist or FOSS developer
 * Uses OpenAI to analyze user data and determine if they are an active scientist or FOSS developer
 */
export class ScientistOnboardingRunner extends BaseOpenAIRunner {
  protected getModelOptions(): ResponseCreateParams | undefined {
    return {
      model: 'gpt-5-nano-2025-08-07', // TODO: Update the model name.
      temperature: 0.0,
      prompt_cache_key: 'scientist-onboarding',
      reasoning: {
        effort: OVERRIDE_REASONING_EFFORT ?? 'low'
      }
    };
  }

  protected useWebSearchTool(): boolean {
    return true;
  }

  /**
   * Initiate the scientist check request
   * @param task - The task containing user data to analyze
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    const prompt = onboardingPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, prompt, scientistCheckSchema, this.getModelOptions());
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

  protected useWebSearchTool(): boolean {
    return true;
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
 * Can be conditionally cancelled based on worth threshold dependencies
 */
export class RandomizePromptRunner extends BaseOpenAIRunner {
  protected getModelOptions(): ResponseCreateParams | undefined {
    return {
      temperature: 1.0, // We want randomized responses.
    };
  }

  /**
   * Execute the task with conditional logic based on worth threshold
   * @param task - The task to execute
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    // Check if this is a randomization task for prompt injection that depends on worth threshold
    const isInjectionRandomization = this.data.originalPrompt === injectionPrompt;
    
    if (isInjectionRandomization) {
      // Check if any dependency is a WorthThresholdCheckRunner that didn't exceed threshold
      const thresholdDep = task.dependencies.find(dep => 
        dep.dependency.runnerClassName === 'WorthThresholdCheckRunner'
      );

      if (thresholdDep && thresholdDep.dependency.status === 'COMPLETED' && thresholdDep.dependency.runnerData) {
        try {
          const thresholdData = JSON.parse(thresholdDep.dependency.runnerData);
          if (!thresholdData.exceedsThreshold) {
            // Worth <= 1e-11, cancel this randomization task
            await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, task.id, 'Worth threshold not exceeded (<=1e-11), skipping prompt injection randomization');
            return;
          }
        } catch (error) {
          this.log('warn', `Failed to parse threshold check result`, { 
            thresholdTaskId: thresholdDep.dependency.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // If no cancellation condition met, proceed with normal execution
    await this.initiateRequest(task);
  }

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
    await this.initiateOpenAIRequest(task, randomizeRequest, randomizedPromptSchema, this.getModelOptions());
  }
}

/**
 * TaskRunner for detecting prompt injection using randomized prompts
 * Analyzes user data to detect deliberate prompt injection attempts
 * If injection is detected, bans the user directly and marks task as CANCELLED
 */
export class PromptInjectionRunner extends RunnerWithRandomizedPrompt {
  /**
   * Get the original prompt that should be randomized
   * @returns The original injection prompt
   */
  protected getOriginalPrompt(): string {
    return injectionPrompt;
  }

  protected useWebSearchTool(): boolean {
    return true;
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
      // Skip the actual injection check and return true directly, then ban user
      await this.handleInjectionDetected(task, 'Injection already detected by parent PromptInjectionRunner task');
      return;
    }

    // If no parent detected injection, proceed with normal execution
    await this.initiateRequest(task);
  }

  /**
   * Handle the case when prompt injection is detected
   * Bans the user and marks the task as CANCELLED
   * @param task - The task to process
   * @param reason - Reason for injection detection
   */
  private async handleInjectionDetected(task: TaskWithDependencies, reason: string): Promise<void> {
    const userId = this.data.userId;
    if (!userId) {
      throw new TaskRunnerError('User ID is required for banning when injection is detected', task.id, this.constructor.name);
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

    // Mark task as CANCELLED (not COMPLETED) since injection was detected
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        runnerData: JSON.stringify({
          ...this.data,
          hasPromptInjection: true,
          why: reason,
          bannedUntil: banUntil.toISOString(),
          reason: 'Prompt injection detected - user banned',
          cancelledAt: new Date().toISOString()
        })
      }
    });

    this.log('info', `🚫 Prompt injection detected - user banned and task cancelled`, { 
      taskId: task.id,
      userId, 
      bannedUntil: banUntil.toISOString(),
      reason
    });
  }

  /**
   * Override the base method to handle injection detection after OpenAI request
   * @param task - The task to process
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    
    // Get randomized prompt from dependency (randomizePrompt task)
    const randomizedPrompt = await this.getRandomizedPromptFromDependency(task);
    const finalPrompt = randomizedPrompt.replace('<DATA>', JSON.stringify(userData));
    
    // Make the OpenAI request
    const customId = uuidv4();
    await this.updateTaskWithRequestData(task, customId);
    const result = await this.makeOpenAIRequest(finalPrompt, this.getResponseSchema(), customId);
    
    // Get the result and check for injection
    const response: PromptInjectionResponse = await this.getOpenAIResult({ 
      customId, 
      storeId: result.storeId 
    });

    if (response.hasPromptInjection) {
      // Injection detected - ban user and mark as CANCELLED
      await this.handleInjectionDetected(task, response.why);
    } else {
      // No injection detected - mark as completed normally
      await this.prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          runnerData: JSON.stringify({
            ...this.data,
            customId,
            storeId: result.storeId,
            hasPromptInjection: false,
            why: response.why,
            completedAt: new Date().toISOString()
          })
        }
      });

      this.log('info', `✅ No prompt injection detected`, { 
        taskId: task.id,
        why: response.why
      });
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
}
