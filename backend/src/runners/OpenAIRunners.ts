import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIRunner, createAIOutputter } from '../services/openai.js';
import { onboardingPrompt, randomizePrompt, worthPrompt, injectionPrompt, scientistCheckSchema, worthAssessmentSchema, promptInjectionSchema, randomizedPromptSchema } from '../prompts.js';
import { v4 as uuidv4 } from 'uuid';
import { ResponseCreateParams, ResponseCreateParamsNonStreaming, ResponseTextConfig, Tool, ToolChoiceOptions } from 'openai/resources/responses/responses';
import { ReasoningEffort } from 'openai/resources';
import { BaseRunner, registerUtilityRunners } from './UtilityRunners.js';

// Constants
const DEFAULT_MODEL = process.env.OPENAI_MODEL!;
const OVERRIDE_REASONING_EFFORT = process.env.OPENAI_OVERRIDE_REASONING_EFFORT ?
  process.env.OPENAI_OVERRIDE_REASONING_EFFORT as ReasoningEffort : undefined;
const DEFAULT_TEMPERATURE = 0.2;
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
        required: ["query"],
        additionalProperties: false
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
   * Log an OpenAI request to the database
   * @param customId - Unique identifier for this request
   * @param storeId - Store ID for result retrieval
   * @param requestData - The request data sent to OpenAI
   * @param taskId - Optional task ID that initiated the request
   */
  protected async logOpenAIRequest(
    customId: string,
    storeId: string,
    requestData: any,
    taskId?: number
  ): Promise<void> {
    try {
      await this.prisma.openAILog.create({
        data: {
          customId,
          storeId,
          runnerClassName: this.runnerName,
          requestData: JSON.stringify(requestData),
          requestInitiated: new Date(),
          userId: this.data.userId || null,
          taskId: taskId || null
        }
      });
      
      this.log('info', `📝 Logged OpenAI request`, { 
        customId, 
        storeId, 
        taskId,
        userId: this.data.userId 
      });
    } catch (error) {
      this.log('error', `Failed to log OpenAI request`, { 
        customId, 
        error: error instanceof Error ? error.message : String(error) 
      });
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
   * Make an OpenAI request using the `flexible-batches` API
   * @param prompt - The prompt to send to OpenAI
   * @param schema - The JSON schema for response format
   * @param customId - Unique identifier for this request
   * @param options - Additional options for the request
   * @param taskId - Optional task ID that initiated the request
   * @returns Promise resolving to store ID for result retrieval
   */
  protected async makeOpenAIRequest(
    prompt: string,
    schema: any,
    customId: string,
    options: ResponseCreateParams = {},
    taskId?: number
  ): Promise<OpenAIRequestResult> {
    const store = await createAIBatchStore(undefined);
    const runner = await createAIRunner(store);
    
    const requestBody = <ResponseCreateParamsNonStreaming>{
      instructions: prompt, // system/developer message.
      input: prompt, // user's message - use the prompt as input
      model: options?.model ?? DEFAULT_MODEL,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      // include: ['web_search_call.action.sources'], // FIXME: doesn't work due to https://github.com/openai/openai-node/issues/1645
      reasoning: options?.reasoning === null ? null : {
        effort: OVERRIDE_REASONING_EFFORT ?? options?.reasoning?.effort ?? 'medium'
      },
      ...(this.useWebSearchTool() ? USE_WEB_SEARCH_TOOL : {}),
      text: <ResponseTextConfig>{
        format: {
          type: "json_schema" as const,
          name: "response",
          schema: schema,
          strict: true
        },
        verbosity: 'medium'
      }
    };
    
    // Add the request to the runner
    await runner.addItem({
      custom_id: customId,
      method: "POST",
      body: requestBody
    });
    
    // Flush to execute the request
    await runner.flush();
    
    const storeId = store.getStoreId();
    
    // Log the request to the database
    await this.logOpenAIRequest(customId, storeId, requestBody, taskId);
    
    // Return the store ID for later result retrieval
    return { storeId };
  }

  /**
   * Common method to update task with runner data after initiating an OpenAI request
   * @param task - The task to update
   * @param customId - Unique identifier for the request
   * @param additionalData - Additional data to include in runner data
   */
  protected async updateTaskWithRequestData( // TODO: Is this needed?
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
    await this.makeOpenAIRequest(prompt, schema, customId, options, task.id);
  }


  /**
   * Helper method to get a single dependency result by runner class name
   * @param task - The task with dependencies
   * @param runnerClassName - The class name of the runner to look for
   * @returns The dependency result or null if not found
   */
  protected async getDependencyResult( // TODO: This function is suspected, because we may need to get data from several dependencies.
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

  /**
   * Initiate the scientist check request
   * @param task - The task containing user data to analyze
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> { // TODO: two identical methods
    await this.initiateRequest(task);
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
 */
export class WorthAssessmentRunner extends RunnerWithRandomizedPrompt {
  /**
   * Get the original prompt that should be randomized
   * @returns The original worth prompt
   */
  protected getOriginalPrompt(): string { // TODO: This method (in parent class, too) seems to be useless.
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
    await this.initiateRequest(task);
  }

  /**
   * Initiate the prompt randomization request
   * @param task - The task containing the original prompt to randomize
   */
  protected async initiateRequest(task: TaskWithDependencies): Promise<void> {
    const originalPrompt = this.data.originalPrompt;
    if (!originalPrompt) { // TODO: Should not happen.
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
    await this.prisma.task.update({ // TODO: seems to have superfluous parameters.
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
    
    await this.initiateOpenAIRequest(task, finalPrompt, this.getResponseSchema(), this.getModelOptions());
  }
}


/**
 * Register all OpenAI TaskRunners with the TaskRunnerRegistry
 * This function should be called during application initialization to make all runners available
 */
export function registerOpenAIRunners(): void {
  TaskRunnerRegistry.register('ScientistOnboardingRunner', ScientistOnboardingRunner);
  TaskRunnerRegistry.register('RandomizePromptRunner', RandomizePromptRunner);
  TaskRunnerRegistry.register('WorthAssessmentRunner', WorthAssessmentRunner);
  TaskRunnerRegistry.register('PromptInjectionRunner', PromptInjectionRunner);
}

/**
 * Register all TaskRunners (both OpenAI and Utility) with the TaskRunnerRegistry
 * This function should be called during application initialization to make all runners available
 */
export function registerAllRunners(): void {
  // Register OpenAI runners
  registerOpenAIRunners();
  
  // Register utility runners
  registerUtilityRunners();
}
