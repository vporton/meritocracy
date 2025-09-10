import { TaskRunner, TaskRunnerData, TaskRunnerRegistry } from '../types/task.js';
import { PrismaClient } from '@prisma/client';
import { createAIBatchStore, createAIRunner, createAIOutputter } from '../services/openai.js';
import { onboardingPrompt, randomizePrompt, worthPrompt, injectionPrompt } from '../prompts.js';
import { v4 as uuidv4 } from 'uuid';

// Response schemas for OpenAI API
const scientistCheckSchema = {
  type: "object",
  properties: {
    isActiveScientistOrFOSSDev: {
      type: "boolean",
      description: "Whether the person is an active scientist or FOSS developer"
    },
    why: {
      type: "string",
      description: "Explanation of the decision"
    }
  },
  required: ["isActiveScientistOrFOSSDev", "why"]
};

const worthAssessmentSchema = {
  type: "object",
  properties: {
    worthAsFractionOfGDP: {
      type: "number",
      description: "The fraction of world GDP this person is worth (0-1)"
    },
    why: {
      type: "string",
      description: "Explanation of the assessment"
    }
  },
  required: ["worthAsFractionOfGDP", "why"]
};

const promptInjectionSchema = {
  type: "object",
  properties: {
    hasPromptInjection: {
      type: "boolean",
      description: "Whether prompt injection was detected"
    },
    why: {
      type: "string",
      description: "Explanation of the detection result"
    }
  },
  required: ["hasPromptInjection", "why"]
};

/**
 * Base class for OpenAI TaskRunners with common functionality
 */
abstract class BaseOpenAIRunner implements TaskRunner {
  protected data: TaskRunnerData;
  protected prisma: PrismaClient;

  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
  }

  async run(taskId: number): Promise<void> {
    try {
      console.log(`🤖 Running OpenAI TaskRunner: ${this.constructor.name} for task ${taskId}`);
      
      // Get task data from database
      const task = await this.getTaskWithDependencies(taskId);

      // Check if all dependencies are completed
      if (!this.areDependenciesCompleted(task)) {
        console.log(`⏳ Task ${taskId} has incomplete dependencies, remaining PENDING`);
        return; // Task remains in PENDING state
      }

      // Execute the specific logic (either OpenAI request or custom processing)
      await this.executeTask(task);
      
      console.log(`✅ OpenAI TaskRunner ${this.constructor.name} completed for task ${taskId}`);
    } catch (error) {
      console.error(`❌ Error in OpenAI TaskRunner ${this.constructor.name}:`, error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Get task with dependencies from database
   */
  protected async getTaskWithDependencies(taskId: number): Promise<any> {
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
      throw new Error(`Task with ID ${taskId} not found`);
    }

    return task;
  }

  /**
   * Check if all dependencies are completed
   */
  protected areDependenciesCompleted(task: any): boolean {
    const incompleteDependencies = task.dependencies.filter((dep: any) => 
      dep.dependency.status !== 'COMPLETED'
    );
    return incompleteDependencies.length === 0;
  }

  /**
   * Execute the task - can be overridden for custom logic
   */
  protected async executeTask(task: any): Promise<void> {
    await this.initiateRequest(task);
  }

  protected abstract initiateRequest(task: any): Promise<void>;

  public async getOpenAIResult({ customId, storeId }: { customId: string; storeId: string }): Promise<any> {
    const store = await createAIBatchStore(storeId);
    const outputter = await createAIOutputter(store);
    
    const response = await outputter.getOutputOrThrow(customId);
    
    // Parse the response content
    const content = (response as any).choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content received from OpenAI');
    }
    
    return JSON.parse(content);
  }

  protected async makeOpenAIRequest(
    prompt: string,
    schema: any,
    customId: string,
  ): Promise<{ storeId: string }> {
    const store = await createAIBatchStore(undefined);
    const runner = await createAIRunner(store);
    
    
    // Add the request to the runner
    await runner.addItem({
      custom_id: customId,
      method: "POST",
      body: {
        messages: [ // TODO: Put <DATA> in "user" prompt not "system".
          {
            role: "system" as const,
            content: prompt
          }
        ],
        model: "gpt-5-nano-2025-08-07", // FIXME
        temperature: 0,
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
    
    // Return both the custom ID and store ID for later result retrieval
    return { storeId: store.getStoreId() };
  }

  /**
   * Common method to update task with runner data after initiating an OpenAI request
   */
  protected async updateTaskWithRequestData(task: any, customId: string, additionalData: any = {}): Promise<void> {
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
   */
  protected async initiateOpenAIRequest(
    task: any,
    prompt: string,
    schema: any,
    additionalData: any = {}
  ): Promise<void> {
    const customId = uuidv4();
    // Update database first to ensure consistent state
    await this.updateTaskWithRequestData(task, customId, additionalData);
    // Then initiate the OpenAI request
    await this.makeOpenAIRequest(prompt, schema, customId);
  }
}

/**
 * TaskRunner for checking if a user is an active scientist or FOSS developer
 */
export class ScientistOnboardingRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    const userData = this.data.userData || {};
    const prompt = onboardingPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, prompt, scientistCheckSchema);
  }
}

/**
 * TaskRunner for assessing user worth as fraction of GDP
 */
export class WorthAssessmentRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    const userData = this.data.userData || {};
    
    // Get randomized prompt from dependency (randomizePrompt task)
    const randomizedPrompt = await this.getRandomizedPromptFromDependency(task);
    const finalPrompt = randomizedPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, finalPrompt, worthAssessmentSchema);
  }

  private async getRandomizedPromptFromDependency(task: any): Promise<string> {
    // Find the randomizePrompt dependency
    const randomizeDependency = task.dependencies.find((dep: any) => 
      dep.dependency.runnerClassName === 'RandomizePromptRunner'
    );

    if (!randomizeDependency) {
      throw new Error('RandomizePromptRunner dependency not found');
    }

    // Get the result from the randomizePrompt task
    const depTask = randomizeDependency.dependency;
    if (!depTask.runnerData) {
      throw new Error('RandomizePromptRunner dependency has no runner data');
    }

    const depData = JSON.parse(depTask.runnerData);
    if (!depData.customId || !depData.storeId) {
      throw new Error('RandomizePromptRunner dependency missing customId or storeId');
    }

    const response = await this.getOpenAIResult({ 
      customId: depData.customId, 
      storeId: depData.storeId 
    });

    return response.randomizedPrompt;
  }
}

/**
 * TaskRunner for randomizing prompts
 */
export class RandomizePromptRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    const originalPrompt = this.data.originalPrompt;
    const randomizeRequest = randomizePrompt.replace('<PROMPT>', originalPrompt);
    
    const schema = {
      type: "object",
      properties: {
        randomizedPrompt: {
          type: "string",
          description: "The randomized version of the prompt"
        }
      },
      required: ["randomizedPrompt"]
    };
    
    await this.initiateOpenAIRequest(task, randomizeRequest, schema);
  }
}

/**
 * TaskRunner for detecting prompt injection
 */
export class PromptInjectionRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    const userData = this.data.userData || {};
    const prompt = injectionPrompt.replace('<DATA>', JSON.stringify(userData));
    
    await this.initiateOpenAIRequest(task, prompt, promptInjectionSchema);
  }
}

/**
 * TaskRunner for calculating median from dependency results
 */
export class MedianRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    // This runner doesn't make OpenAI requests, it processes results from dependencies
    // The actual work is done in executeTask
  }

  protected async executeTask(task: any): Promise<void> {
    // Extract worth values from dependency results
    const worthValues: number[] = [];
    
    for (const dep of task.dependencies) {
      try {
        // Get the dependency task data
        if (!dep.dependency.runnerData) {
          console.warn(`Dependency ${dep.dependency.id} has no runner data`);
          continue;
        }

        const depData = JSON.parse(dep.dependency.runnerData);
        if (!depData.customId || !depData.storeId) {
          console.warn(`Dependency ${dep.dependency.id} missing customId or storeId`);
          continue;
        }

        // Get the result from the dependency
        const response = await this.getOpenAIResult({ 
          customId: depData.customId, 
          storeId: depData.storeId 
        });

        if (typeof response.worthAsFractionOfGDP === 'number') {
          worthValues.push(response.worthAsFractionOfGDP);
        }
      } catch (error) {
        console.warn(`Failed to retrieve dependency ${dep.dependency.id} result:`, error);
      }
    }

    if (worthValues.length === 0) {
      throw new Error('No valid worth values found in dependencies');
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

    console.log(`✅ Median TaskRunner completed for task ${task.id}. Median: ${median}`);
  }

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
 */
export class WorthThresholdCheckRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    // This runner doesn't make OpenAI requests, it processes results from dependencies
    // The actual work is done in executeTask
  }

  protected async executeTask(task: any): Promise<void> {
    // Get the worth value from the first dependency
    let worthValue: number | null = null;
    const threshold = this.data.threshold || 1e-11;

    for (const dep of task.dependencies) {
      try {
        // Get the dependency task data
        if (!dep.dependency.runnerData) {
          console.warn(`Dependency ${dep.dependency.id} has no runner data`);
          continue;
        }

        const depData = JSON.parse(dep.dependency.runnerData);
        if (!depData.customId || !depData.storeId) {
          console.warn(`Dependency ${dep.dependency.id} missing customId or storeId`);
          continue;
        }

        // Get the result from the dependency
        const response = await this.getOpenAIResult({ 
          customId: depData.customId, 
          storeId: depData.storeId 
        });

        if (typeof response.worthAsFractionOfGDP === 'number') {
          worthValue = response.worthAsFractionOfGDP;
          break;
        }
      } catch (error) {
        console.warn(`Failed to retrieve dependency ${dep.dependency.id} result:`, error);
      }
    }

    if (worthValue === null) {
      throw new Error('No valid worth value found in dependencies');
    }

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

    console.log(`✅ Worth Threshold Check completed for task ${task.id}. Worth: ${worthValue}, Exceeds: ${exceedsThreshold}`);
  }
}

/**
 * TaskRunner for banning users (when prompt injection is detected)
 */
export class BanUserRunner extends BaseOpenAIRunner {
  protected async initiateRequest(task: any): Promise<void> {
    // This runner doesn't make OpenAI requests, it bans users
    // The actual work is done in executeTask
  }

  protected async executeTask(task: any): Promise<void> {
    const userId = this.data.userId;
    if (!userId) {
      throw new Error('User ID is required for banning');
    }

    // Ban user for 1 year
    const banUntil = new Date();
    banUntil.setFullYear(banUntil.getFullYear() + 1);

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

    console.log(`✅ User ${userId} banned until ${banUntil.toISOString()}`);
  }
}

// Register all OpenAI TaskRunners
export function registerOpenAIRunners(): void {
  TaskRunnerRegistry.register('ScientistCheckRunner', ScientistOnboardingRunner);
  TaskRunnerRegistry.register('RandomizePromptRunner', RandomizePromptRunner);
  TaskRunnerRegistry.register('WorthAssessmentRunner', WorthAssessmentRunner);
  TaskRunnerRegistry.register('PromptInjectionRunner', PromptInjectionRunner);
  TaskRunnerRegistry.register('WorthThresholdCheckRunner', WorthThresholdCheckRunner);
  TaskRunnerRegistry.register('MedianRunner', MedianRunner);
  TaskRunnerRegistry.register('BanUserRunner', BanUserRunner);
}
