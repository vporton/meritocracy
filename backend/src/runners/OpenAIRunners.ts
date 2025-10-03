import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIRunner, createAIOutputter } from '../services/openai.js';
import { onboardingPrompt, randomizePrompt, worthPrompt, injectionPrompt, scientistCheckSchema, worthAssessmentSchema, promptInjectionSchema, randomizedPromptSchema } from '../prompts.js';
import { v4 as uuidv4 } from 'uuid';
import { ResponseCreateParams, ResponseCreateParamsNonStreaming, ResponseTextConfig, Tool, ToolChoiceOptions } from 'openai/resources/responses/responses';
import { ReasoningEffort } from 'openai/resources';
import { BaseRunner, registerUtilityRunners } from './UtilityRunners.js';
import { isConfigValueTrue } from '../services/utils.js';

// Constants
const DEFAULT_MODEL = process.env.OPENAI_MODEL!;
const NO_REASONING = isConfigValueTrue(process.env.OPENAI_NO_REASONING);
const OVERRIDE_REASONING_EFFORT = process.env.OPENAI_OVERRIDE_REASONING_EFFORT ?
  process.env.OPENAI_OVERRIDE_REASONING_EFFORT as ReasoningEffort : undefined;
const OVERRIDE_MAX_TOOL_CALLS = process.env.OPENAI_OVERRIDE_MAX_TOOL_CALLS ?
  parseInt(process.env.OPENAI_OVERRIDE_MAX_TOOL_CALLS) : undefined;
const DEFAULT_TEMPERATURE = 0.2;
const BAN_DURATION_YEARS = 1;
const OPEN_AI_FAKE = isConfigValueTrue(process.env.OPEN_AI_FAKE);

/**
 * Generate a user prompt string from user data for AI analysis
 * Only includes connected accounts (non-null values) in the prompt
 * @param userData - User data object containing account information
 * @returns Formatted string with connected account information
 */
function generateUserPrompt(userData: any): string {
  if (!userData || typeof userData !== 'object') {
    return 'No user account information available.';
  }

  const accountInfo: string[] = [];
  
  // I provide full URLs for all accounts, not just account names, because
  /// gpt-5-mini once said:
  // "Only a GitHub username (vporton) was provided. Without reviewing the user's profile, repositories, contributions, or any publication/affiliation information I cannot verify that they are an active scientist or FOSS developer. Please provide a profile link or additional details (repo list, affiliation, publications) so I can re-check."

  // Add ORCID if connected
  if (userData.orcidId) {
    accountInfo.push(`ORCID: https://orcid.org/${userData.orcidId}`);
  }
  
  // Add GitHub if connected
  if (userData.githubHandle) {
    accountInfo.push(`GitHub: https://github.com/${userData.githubHandle}`);
  }
  
  // Add BitBucket if connected
  if (userData.bitbucketHandle) {
    accountInfo.push(`BitBucket: https://bitbucket.org/${userData.bitbucketHandle}`);
  }
  
  // Add GitLab if connected
  if (userData.gitlabHandle) {
    accountInfo.push(`GitLab: https://gitlab.com/${userData.gitlabHandle}`);
  }
  
  // Add Ethereum address if connected
  if (userData.ethereumAddress) {
    accountInfo.push(`Ethereum: ${userData.ethereumAddress}`);
  }
  
  // Add name if available
  if (userData.name) {
    accountInfo.push(`Name: ${userData.name}`);
  }
  
  // Add email if available and verified
  if (userData.email && userData.emailVerified) {
    accountInfo.push(`Email: ${userData.email}`);
  }

  if (accountInfo.length === 0) {
    return 'No connected accounts or profile information available.';
  }

  // return `User account information:\n${accountInfo.join('\n')}`;
  return accountInfo.join('\n');
}

const USE_WEB_SEARCH_TOOL = {
  tools: <Tool[]>[
    {
      // "name": "web",
      "type": "web_search"
    }
  ],
  // tool_choice: <ToolChoiceOptions>'required', // commented out to eliminate infinite loop with Web search.
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
      storeId: string | null;
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
  hasPromptInjectionOrPlagiarism: boolean;
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
export abstract class BaseOpenAIRunner extends BaseRunner {
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
    input: string,
    schema: any,
    customId: string,
    options: ResponseCreateParams | undefined = {},
    taskId: number
  ): Promise<OpenAIRequestResult> {
    const store = await createAIBatchStore(undefined, taskId);
    const storeId = store.getStoreId();
    await this.prisma.task.update({
      where: { id: taskId },
      data: { storeId }
    });
    const runner = await createAIRunner(store);
    
    const requestBody = <ResponseCreateParamsNonStreaming | {max_tool_calls: number}>{
      instructions: prompt, // system/developer message.
      input: input, // user's message - use the prompt as input
      model: options?.model ?? DEFAULT_MODEL,
      ...(/gpt-5-mini/.test(options?.model ?? DEFAULT_MODEL)
        ? {/* temperature not supported */} : options?.temperature === undefined
        ? { temperature: options.temperature } : {temperature: DEFAULT_TEMPERATURE}),
      // include: ['web_search_call.action.sources'], // TODO@P3: doesn't work due to https://github.com/openai/openai-node/issues/1645
      reasoning: NO_REASONING ? null : options?.reasoning === null ? null : {
        effort: OVERRIDE_REASONING_EFFORT ?? options?.reasoning?.effort ?? 'medium'
      },
      max_tool_calls: OVERRIDE_MAX_TOOL_CALLS ?? 10, // TODO@P3
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
  protected async updateTaskWithRequestData(
    task: TaskWithDependencies, 
    customId: string, 
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    // Need set something except `customId`?
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
    input: string,
    schema: any,
    options: ResponseCreateParams | undefined = {},
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    const customId = uuidv4();
    // Update database first to ensure consistent state
    await this.updateTaskWithRequestData(task, customId, additionalData);
    
   
    // Check if fake mode is enabled
    if (OPEN_AI_FAKE) {
      await this.handleFakeModeResponse(task, customId, additionalData);
      return;
    } else {
    // Then initiate the OpenAI request
      await this.makeOpenAIRequest(prompt, input, schema, customId, options, task.id);
    }
  }

  /**
   * Handle fake mode responses based on runner type
   * @param task - The task to process
   * @param customId - Unique identifier for this request
   * @param additionalData - Additional data to include in runner data
   */
  protected async handleFakeModeResponse(
    task: TaskWithDependencies,
    customId: string,
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    const runnerName = this.constructor.name;
    let fakeResponse: any = {};

    // TODO@P3: Seems out-of-place here.
    const store = await createAIBatchStore(undefined, task.id);
    const storeId = store.getStoreId();
    await this.prisma.task.update({ // Replace this by one `.insert`.
      where: { id: task.id },
      data: { storeId }
    });

    switch (runnerName) {
      case 'ScientistOnboardingRunner':
        fakeResponse = {
          isActiveScientistOrFOSSDev: true,
          why: 'Fake mode: Always return true for onboarding'
        };
        break;
      case 'WorthAssessmentRunner':
        fakeResponse = {
          worthAsFractionOfGDP: 0.001, // 0.1% of GDP
          why: 'Fake mode: Always return 0.1% of GDP'
        };
        break;
      case 'PromptInjectionRunner':
        fakeResponse = {
          hasPromptInjectionOrPlagiarism: false,
          why: 'Fake mode: Always return no injection'
        };
        break;
      case 'RandomizePromptRunner':
        fakeResponse = {
          randomizedPrompt: this.data.originalPrompt || 'Original prompt not available'
        };
        break;
      default:
        fakeResponse = {
          error: 'Unknown runner type in fake mode',
          why: 'Fake mode: Unknown runner type'
        };
    }

    // Log the fake response
    await this.logOpenAIRequest(customId, 'fake-mode', { fakeResponse }, task.id);
    await this.logOpenAIResponse(customId, fakeResponse);

    // Store the fake response in nonBatchMapping table for getResponseByCustomId to find
    // const fakeOpenAIResponse = {
    //   choices: [{
    //     message: {
    //       content: fakeResponse
    //     }
    //   }]
    // };
    
    // Only store if we have a non-batch store (which has storeResponseByCustomId method)
    if ('storeResponseByCustomId' in store) {
      await (store as any).storeResponseByCustomId({
        customId,
        response: fakeResponse/*fakeOpenAIResponse*/ as any
      });
    }

    // Update task with fake response
    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        runnerData: JSON.stringify({
          ...this.data,
          ...additionalData,
          customId,
          requestInitiated: true,
          initiatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          ...fakeResponse
        }),
        storeId
      }
    });
  }


  /**
   * Helper method to get a single dependency result by runner class name
   * @param task - The task with dependencies
   * @param runnerClassName - The class name of the runner to look for
   * @returns The dependency result or null if not found
   */
  protected async getDependencyResult( // TODO@P3: This function is suspected, because we may need to get data from several dependencies.
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
    if (!depData.customId) {
      throw new DependencyError(`${runnerClassName} dependency missing customId`, depTask.id, task.id, this.constructor.name);
    }

    // Get storeId from the task table, not from runnerData
    if (!depTask.storeId) {
      throw new DependencyError(`${runnerClassName} dependency missing storeId`, depTask.id, task.id, this.constructor.name);
    }

    return await this.getOpenAIResult({ 
      customId: depData.customId, 
      storeId: depTask.storeId 
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

    if (!response) {
      throw new DependencyError('RandomizePromptRunner dependency returned no response', undefined, task.id, this.constructor.name);
    }
    
    if (!response.randomizedPrompt) {
      throw new DependencyError('RandomizePromptRunner dependency response missing randomizedPrompt field', undefined, task.id, this.constructor.name);
    }
    
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
   * Execute the task using a randomized prompt from dependency
   * @param task - The task containing user data and dependencies
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    
    // In fake mode, use the original prompt directly instead of getting randomized prompt
    let promptToUse: string;
    if (OPEN_AI_FAKE) {
      promptToUse = this.getOriginalPrompt();
    } else {
      // Get randomized prompt from dependency (randomizePrompt task)
      promptToUse = await this.getRandomizedPromptFromDependency(task);
    }
    
    const userPrompt: string = generateUserPrompt(userData);
    
    await this.initiateOpenAIRequest(task, promptToUse, userPrompt, this.getResponseSchema(), this.getModelOptions());
  }

}

/**
 * TaskRunner for checking if a user is an active scientist or FOSS developer
 * Uses OpenAI to analyze user data and determine if they are an active scientist or FOSS developer
 */
export class ScientistOnboardingRunner extends BaseOpenAIRunner {
  protected getModelOptions(): ResponseCreateParams | undefined { // https://github.com/openai/openai-node/issues/1572
    return {
      model: 'gpt-5-mini', // Don't use gpt-5-nano: it tends to enter infinite loop with Web search.
      // temperature: 0.0, // Cursor says, it's unsupported.
      prompt_cache_key: 'scientist-onboarding',
      reasoning: {
        effort: OVERRIDE_REASONING_EFFORT ?? 'low'
      },
      max_tool_calls: 3
    } as any;
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
    const userPrompt: string = generateUserPrompt(userData);
    
    await this.initiateOpenAIRequest(task, onboardingPrompt, userPrompt, scientistCheckSchema, this.getModelOptions());
  }

  // Simplify this and similar functions.
  protected async onOutput(customId: string, output: any): Promise<void> {
    if (output.isActiveScientistOrFOSSDev) {
      await TaskRunnerRegistry.completeTask(this.prisma, this.taskId, output);
    } else {
      await TaskRunnerRegistry.markTaskAsCancelled(this.prisma, this.taskId);
    }
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
  protected getOriginalPrompt(): string { // This method (in parent class, too) seems to be useless.
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
   * Override onOutput to capture sources from the OpenAI response
   */
  protected async onOutput(customId: string, output: any): Promise<void> {
    // Get the full response to extract sources
    const fullResponse = await this.getFullOpenAIResponse(customId);
    const sources = this.extractSourcesFromResponse(fullResponse);
    
    // Store the output with sources
    const outputWithSources = {
      ...output,
      sources: sources
    };
    
    await TaskRunnerRegistry.completeTask(this.prisma, this.taskId, outputWithSources);
  }

  /**
   * Get the full OpenAI response including metadata
   */
  private async getFullOpenAIResponse(customId: string): Promise<any> {
    const task = await this.getTaskWithDependencies(this.taskId);
    if (!task.storeId) {
      throw new Error('No storeId found for task');
    }
    
    const store = await createAIBatchStore(task.storeId, this.taskId);
    const outputter = await createAIOutputter(store);
    
    try {
      const response = (await outputter.getOutput(customId))!;
      return response;
    } catch (error) {
      this.log('error', 'Failed to get full OpenAI response', { customId, error });
      return null;
    }
  }

  /**
   * Extract sources from OpenAI response
   */
  private extractSourcesFromResponse(response: any): string[] {
    if (!response || !response.output) {
      return [];
    }

    const sources: string[] = [];
    
    // Look through all output messages for web search results
    for (const message of response.output) {
      if (message && message.content) {
        for (const content of message.content) {
          if (content.type === 'text' && content.text) {
            // Look for URLs in the text content
            const urlMatches = content.text.match(/https?:\/\/[^\s\)]+/g);
            if (urlMatches) {
              sources.push(...urlMatches);
            }
          }
          
          // Look for web search sources in the content
          if (content.sources && Array.isArray(content.sources)) {
            for (const source of content.sources) {
              if (source.url) {
                sources.push(source.url);
              }
            }
          }
        }
      }
      
      // Look for web search calls in the message
      if (message.web_search_call && message.web_search_call.action && message.web_search_call.action.sources) {
        for (const source of message.web_search_call.action.sources) {
          if (source.url) {
            sources.push(source.url);
          }
        }
      }
    }
    
    // Remove duplicates
    return [...new Set(sources)];
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
   * Execute the prompt randomization task
   * @param task - The task containing the original prompt to randomize
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const originalPrompt = this.data.originalPrompt;
    if (!originalPrompt) { // Should not happen.
      throw new TaskRunnerError('Original prompt is required for randomization', task.id, this.constructor.name);
    }
    
    await this.initiateOpenAIRequest(task, randomizePrompt, originalPrompt, randomizedPromptSchema, this.getModelOptions());
  }

  protected async onOutput(customId: string, output: any): Promise<void> {
    await TaskRunnerRegistry.completeTask(this.prisma, this.taskId, output);
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
    await this.prisma.task.update({ // seems to have superfluous parameters.
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        runnerData: JSON.stringify({
          ...this.data,
          hasPromptInjectionOrPlagiarism: true,
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
   * Execute the prompt injection detection task
   * @param task - The task to process
   */
  protected async executeTask(task: TaskWithDependencies): Promise<void> {
    const userData = this.data.userData || {};
    
    // Get randomized prompt from dependency (randomizePrompt task)
    let randomizedPrompt = await this.getRandomizedPromptFromDependency(task);
    
    // Collect URLs from all worth assessment dependencies
    const urlsFromWorthAssessments = await this.collectUrlsFromWorthAssessments(task);
    
    // If we have URLs from worth assessments, modify the prompt to include them
    const sourcesList = urlsFromWorthAssessments.length > 0 ?
      urlsFromWorthAssessments.map(url => `- ${url}`).join('\n') : 'No sources available from worth assessments.';

    // Prompt injection detector should list URLs in the user prompt, not system one,
    // to avoid depending on URLs containing injections.
    const userPrompt: string = generateUserPrompt(userData) + '\n\n' + `URLs to check:\n${sourcesList}`; // TODO@P3: Refactor.
    
    await this.initiateOpenAIRequest(task, randomizedPrompt, userPrompt, this.getResponseSchema(), this.getModelOptions());
  }

  /**
   * Collect URLs from all worth assessment dependencies
   * @param task - The task with dependencies
   * @returns Array of URLs from worth assessments
   */
  private async collectUrlsFromWorthAssessments(task: TaskWithDependencies): Promise<string[]> {
    const allUrls: string[] = [];
    
    // Look for worth assessment tasks in the dependency chain
    for (const dep of task.dependencies) {
      // Check if this dependency is a worth assessment task
      if (dep.dependency.runnerClassName === 'WorthAssessmentRunner' && 
          dep.dependency.status === 'COMPLETED' && 
          dep.dependency.runnerData) {
        
        try {
          const depData = JSON.parse(dep.dependency.runnerData);
          
          // Check if the worth assessment has sources
          if (depData.sources && Array.isArray(depData.sources)) {
            allUrls.push(...depData.sources);
          }
          
          // Also try to get sources from the OpenAI response if available
          if (depData.customId && dep.dependency.storeId) {
            try {
              const response = await this.getOpenAIResult({
                customId: depData.customId,
                storeId: dep.dependency.storeId
              });
              
              if (response && response.sources && Array.isArray(response.sources)) {
                allUrls.push(...response.sources);
              }
            } catch (error) {
              this.log('warn', 'Failed to get sources from worth assessment response', {
                dependencyId: dep.dependency.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } catch (error) {
          this.log('warn', 'Failed to parse worth assessment dependency data', {
            dependencyId: dep.dependency.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    
    // Remove duplicates and return
    return [...new Set(allUrls)];
  }

  protected async onOutput(customId: string, output: any): Promise<void> {
    if (output.hasPromptInjectionOrPlagiarism) {
      // Get the task to pass to handleInjectionDetected
      const task = await this.getTaskWithDependencies(this.taskId);
      await this.handleInjectionDetected(task, output.why || 'Prompt injection detected');
    } else {
      await TaskRunnerRegistry.completeTask(this.prisma, this.taskId, output);
    }
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
