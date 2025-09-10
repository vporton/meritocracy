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

      // Execute the specific OpenAI request
      const result = await this.executeOpenAIRequest(task);
      
      // Store the result in the database
      await this.storeResult(taskId, result);
      
      console.log(`✅ OpenAI TaskRunner ${this.constructor.name} completed for task ${taskId}`);
    } catch (error) {
      console.error(`❌ Error in OpenAI TaskRunner ${this.constructor.name}:`, error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  protected abstract executeOpenAIRequest(task: any): Promise<any>;

  protected async getOpenAIResult(customId: string): Promise<any> {
    const store = await createAIBatchStore(undefined);
    const outputter = await createAIOutputter(store);
    
    const response = await outputter.getOutputOrThrow(customId);
    
    // Parse the response content
    const content = (response as any).choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content received from OpenAI');
    }
    
    return JSON.parse(content);
  }

  protected async storeResult(taskId: number, result: any): Promise<void> {
    // Store the AI response in a custom field or related table
    // For now, we'll store it in the runnerData field // FIXME: Storing in the runnerData field is wrong.
    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        runnerData: JSON.stringify({
          ...this.data,
          aiResult: result,
          completedAt: new Date().toISOString()
        })
      }
    });
  }

  protected async makeOpenAIRequest(
    prompt: string,
    schema: any,
    customId?: string
  ): Promise<string> {
    const store = await createAIBatchStore(undefined);
    const runner = await createAIRunner(store);
    
    const requestId = customId || uuidv4();
    
    // Add the request to the runner
    await runner.addItem({
      custom_id: requestId,
      method: "POST",
      body: {
        messages: [ // TODO: Put <DATA> in "user" prompt not "system".
          {
            role: "system" as const,
            content: prompt
          }
        ],
        model: "gpt-5-nano-2025-08-07",
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
    
    // Return the custom ID for later result retrieval
    return requestId;
  }
}

/**
 * TaskRunner for checking if a user is an active scientist or FOSS developer
 */
export class ScientistCheckRunner extends BaseOpenAIRunner {
  protected async executeOpenAIRequest(task: any): Promise<any> {
    const userData = this.data.userData || {};
    const prompt = onboardingPrompt.replace('<DATA>', JSON.stringify(userData));
    
    const customId = `scientist-check-${task.id}`;
    await this.makeOpenAIRequest(prompt, scientistCheckSchema, customId);
    
    // Wait for the result to be available
    const response = await this.getOpenAIResult(customId);

    return {
      isActiveScientistOrFOSSDev: response.isActiveScientistOrFOSSDev,
      why: response.why,
      userData: userData
    };
  }
}

/**
 * TaskRunner for assessing user worth as fraction of GDP
 */
export class WorthAssessmentRunner extends BaseOpenAIRunner {
  protected async executeOpenAIRequest(task: any): Promise<any> {
    const userData = this.data.userData || {};
    
    // Randomize the prompt
    const randomizedPrompt = await this.randomizePrompt(worthPrompt);
    const finalPrompt = randomizedPrompt.replace('<DATA>', JSON.stringify(userData));
    
    const customId = `worth-assessment-${task.id}`;
    await this.makeOpenAIRequest(finalPrompt, worthAssessmentSchema, customId);
    
    // Wait for the result to be available
    const response = await this.getOpenAIResult(customId);

    return {
      worthAsFractionOfGDP: response.worthAsFractionOfGDP,
      why: response.why,
      userData: userData,
      randomizedPrompt: randomizedPrompt
    };
  }

  private async randomizePrompt(originalPrompt: string): Promise<string> {
    const randomizeRequest = randomizePrompt.replace('<PROMPT>', originalPrompt);
    
    const customId = `randomize-${uuidv4()}`;
    await this.makeOpenAIRequest(
      randomizeRequest,
      {
        type: "object",
        properties: {
          randomizedPrompt: {
            type: "string",
            description: "The randomized version of the prompt"
          }
        },
        required: ["randomizedPrompt"]
      },
      customId
    );

    const response = await this.getOpenAIResult(customId);
    return response.randomizedPrompt;
  }
}

/**
 * TaskRunner for detecting prompt injection
 */
export class PromptInjectionRunner extends BaseOpenAIRunner {
  protected async executeOpenAIRequest(task: any): Promise<any> {
    const userData = this.data.userData || {};
    const prompt = injectionPrompt.replace('<DATA>', JSON.stringify(userData));
    
    const customId = `prompt-injection-${task.id}`;
    await this.makeOpenAIRequest(prompt, promptInjectionSchema, customId);
    
    // Wait for the result to be available
    const response = await this.getOpenAIResult(customId);

    return {
      hasPromptInjection: response.hasPromptInjection,
      why: response.why,
      userData: userData
    };
  }
}

/**
 * TaskRunner for calculating median from dependency results
 */
export class MedianRunner implements TaskRunner {
  private data: TaskRunnerData;
  private prisma: PrismaClient;

  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
  }

  async run(taskId: number): Promise<void> {
    try {
      console.log(`📊 Running Median TaskRunner for task ${taskId}`);
      
      // Get task and its dependencies
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

      // Extract worth values from dependency results using createAIOutputter
      const worthValues: number[] = [];
      
      for (const dep of task.dependencies) {
        try {
          // Create a store and outputter to retrieve the dependency result
          const store = await createAIBatchStore(undefined);
          const outputter = await createAIOutputter(store);
          
          // Try to get the result using the custom ID pattern
          const customId = `worth-assessment-${dep.dependency.id}`;
          const response = await outputter.getOutput(customId);
          
          if (response) {
            const content = (response as any).choices[0]?.message?.content;
            if (content) {
              const result = JSON.parse(content);
              if (typeof result.worthAsFractionOfGDP === 'number') {
                worthValues.push(result.worthAsFractionOfGDP);
              }
            }
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
        where: { id: taskId },
        data: {
          runnerData: JSON.stringify({
            ...this.data,
            medianWorth: median,
            sourceValues: worthValues,
            completedAt: new Date().toISOString()
          })
        }
      });

      console.log(`✅ Median TaskRunner completed for task ${taskId}. Median: ${median}`);
    } catch (error) {
      console.error(`❌ Error in Median TaskRunner:`, error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
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
export class WorthThresholdCheckRunner implements TaskRunner {
  private data: TaskRunnerData;
  private prisma: PrismaClient;

  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
  }

  async run(taskId: number): Promise<void> {
    try {
      console.log(`📊 Running Worth Threshold Check TaskRunner for task ${taskId}`);
      
      // Get task and its dependencies
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

      // Get the worth value from the first dependency using createAIOutputter
      let worthValue: number | null = null;
      const threshold = this.data.threshold || 1e-11;

      for (const dep of task.dependencies) {
        try {
          // Create a store and outputter to retrieve the dependency result
          const store = await createAIBatchStore(undefined);
          const outputter = await createAIOutputter(store);
          
          // Try to get the result using the custom ID pattern
          const customId = `worth-assessment-${dep.dependency.id}`;
          const response = await outputter.getOutput(customId);
          
          if (response) {
            const content = (response as any).choices[0]?.message?.content;
            if (content) {
              const result = JSON.parse(content);
              if (typeof result.worthAsFractionOfGDP === 'number') {
                worthValue = result.worthAsFractionOfGDP;
                break;
              }
            }
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
        where: { id: taskId },
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

      console.log(`✅ Worth Threshold Check completed for task ${taskId}. Worth: ${worthValue}, Exceeds: ${exceedsThreshold}`);
    } catch (error) {
      console.error(`❌ Error in Worth Threshold Check TaskRunner:`, error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

/**
 * TaskRunner for banning users (when prompt injection is detected)
 */
export class BanUserRunner implements TaskRunner {
  private data: TaskRunnerData;
  private prisma: PrismaClient;

  constructor(data: TaskRunnerData) {
    this.data = data;
    this.prisma = new PrismaClient();
  }

  async run(taskId: number): Promise<void> {
    try {
      console.log(`🚫 Running Ban User TaskRunner for task ${taskId}`);
      
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
        where: { id: taskId },
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
    } catch (error) {
      console.error(`❌ Error in Ban User TaskRunner:`, error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }
}

// Register all OpenAI TaskRunners
export function registerOpenAIRunners(): void {
  TaskRunnerRegistry.register('ScientistCheckRunner', ScientistCheckRunner);
  TaskRunnerRegistry.register('WorthAssessmentRunner', WorthAssessmentRunner);
  TaskRunnerRegistry.register('PromptInjectionRunner', PromptInjectionRunner);
  TaskRunnerRegistry.register('WorthThresholdCheckRunner', WorthThresholdCheckRunner);
  TaskRunnerRegistry.register('MedianRunner', MedianRunner);
  TaskRunnerRegistry.register('BanUserRunner', BanUserRunner);
}
