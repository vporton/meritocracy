import { PrismaClient } from '@prisma/client';
import { TaskStatus } from '../types/task.js';
import { worthPrompt } from '../prompts.js';

export interface UserEvaluationData {
  userId: number;
  userData: {
    orcidId?: string;
    githubHandle?: string;
    bitbucketHandle?: string;
    gitlabHandle?: string;
    [key: string]: any;
  };
}

export class UserEvaluationFlow {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create the complete flow graph for user evaluation
   * Returns the root task ID that can be used to start the evaluation
   */
  async createEvaluationFlow(evaluationData: UserEvaluationData): Promise<number> {
    console.log(`🔄 Creating evaluation flow for user ${evaluationData.userId}`);

    // Step 1: Create the initial scientist check task
    const scientistCheckTask = await this.createScientistCheckTask(evaluationData);
    
    // Step 2: Create the first worth assessment task using WorthAsFractionOfGDPRunner (depends on scientist check)
    const firstWorthTask = await this.createWorthAsFractionOfGDPTask(evaluationData, [scientistCheckTask.id]);
    
    // Step 3: Create conditional tasks based on worth threshold
    const conditionalTasks = await this.createConditionalTasks(evaluationData, firstWorthTask.id);
    
    // Step 4: Create the final median calculation task
    const medianTask = await this.createMedianTask(evaluationData, conditionalTasks.worthTasks);
    
    console.log(`✅ Evaluation flow created with root task ${scientistCheckTask.id}`);
    return scientistCheckTask.id;
  }

  /**
   * Create the initial scientist check task
   */
  private async createScientistCheckTask(evaluationData: UserEvaluationData) {
    return await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ScientistCheckRunner',
        runnerData: JSON.stringify({
          userData: evaluationData.userData
        })
      }
    });
  }

  /**
   * Create a randomize prompt task
   */
  private async createRandomizePromptTask(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'RandomizePromptRunner',
        runnerData: JSON.stringify({
          originalPrompt: worthPrompt,
          userData: evaluationData.userData
        })
      }
    });

    // Create dependencies
    for (const depId of dependencies) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Create a worth assessment task using randomized prompts
   */
  private async createWorthAssessmentTask(
    evaluationData: UserEvaluationData, 
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'WorthAssessmentRunner',
        runnerData: JSON.stringify({
          userData: evaluationData.userData
        })
      }
    });

    // Create dependencies
    for (const depId of dependencies) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Create a worth assessment task using WorthAsFractionOfGDPRunner (worthPrompt directly)
   */
  private async createWorthAsFractionOfGDPTask(
    evaluationData: UserEvaluationData, 
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'WorthAsFractionOfGDPRunner',
        runnerData: JSON.stringify({
          userData: evaluationData.userData
        })
      }
    });

    // Create dependencies
    for (const depId of dependencies) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Create conditional tasks based on worth threshold
   */
  private async createConditionalTasks(
    evaluationData: UserEvaluationData, 
    firstWorthTaskId: number
  ) {
    // Create a task to check if worth > 1e-11
    const worthCheckTask = await this.createWorthThresholdCheckTask(evaluationData, [firstWorthTaskId]);
    
    // Create prompt injection tasks (3 of them)
    const promptInjectionTasks = await this.createPromptInjectionTasks(evaluationData, [worthCheckTask.id]);
    
    // Create additional worth assessment tasks (2 more)
    const additionalWorthTasks = await this.createAdditionalWorthTasks(evaluationData, [worthCheckTask.id]);
    
    // Create ban task (depends on prompt injection tasks)
    const banTask = await this.createBanTask(evaluationData, promptInjectionTasks.map(t => t.id));

    return {
      worthCheckTask,
      promptInjectionTasks,
      additionalWorthTasks,
      banTask,
      worthTasks: [firstWorthTaskId, ...additionalWorthTasks.map(t => t.id)]
    };
  }

  /**
   * Create a task to check if worth exceeds threshold
   */
  private async createWorthThresholdCheckTask(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'WorthThresholdCheckRunner',
        runnerData: JSON.stringify({
          threshold: 1e-11,
          userData: evaluationData.userData
        })
      }
    });

    // Create dependencies
    for (const depId of dependencies) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Create 3 prompt injection check tasks
   */
  private async createPromptInjectionTasks(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const tasks = [];
    
    for (let i = 0; i < 3; i++) {
      const task = await this.prisma.task.create({
        data: {
          status: TaskStatus.PENDING,
          runnerClassName: 'PromptInjectionRunner',
          runnerData: JSON.stringify({
            userData: evaluationData.userData,
            checkNumber: i + 1
          })
        }
      });

      // Create dependencies
      for (const depId of dependencies) {
        await this.prisma.taskDependency.create({
          data: {
            taskId: task.id,
            dependencyId: depId
          }
        });
      }

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Create 2 additional worth assessment tasks using WorthAsFractionOfGDPRunner
   */
  private async createAdditionalWorthTasks(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const tasks = [];
    
    for (let i = 0; i < 2; i++) {
      // Create additional worth assessment tasks using WorthAsFractionOfGDPRunner directly
      const worthTask = await this.createWorthAsFractionOfGDPTask(evaluationData, dependencies);
      tasks.push(worthTask);
    }

    return tasks;
  }

  /**
   * Create ban task
   */
  private async createBanTask(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'BanUserRunner',
        runnerData: JSON.stringify({
          userId: evaluationData.userId,
          reason: 'Prompt injection detected'
        })
      }
    });

    // Create dependencies
    for (const depId of dependencies) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Create median calculation task
   */
  private async createMedianTask(
    evaluationData: UserEvaluationData,
    worthTaskIds: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'MedianRunner',
        runnerData: JSON.stringify({
          userId: evaluationData.userId
        })
      }
    });

    // Create dependencies on all worth assessment tasks
    for (const depId of worthTaskIds) {
      await this.prisma.taskDependency.create({
        data: {
          taskId: task.id,
          dependencyId: depId
        }
      });
    }

    return task;
  }

  /**
   * Get the evaluation result for a user
   */
  async getEvaluationResult(userId: number): Promise<any> {
    // Find the most recent evaluation flow for this user
    const tasks = await this.prisma.task.findMany({
      where: {
        runnerData: {
          contains: `"userId":${userId}`
        },
        status: TaskStatus.COMPLETED
      },
      orderBy: {
        completedAt: 'desc'
      }
    });

    // Look for median task result
    const medianTask = tasks.find(task => 
      task.runnerClassName === 'MedianRunner' && 
      task.runnerData?.includes(`"userId":${userId}`)
    );

    if (medianTask && medianTask.runnerData) {
      try {
        const data = JSON.parse(medianTask.runnerData);
        return {
          medianWorth: data.medianWorth,
          sourceValues: data.sourceValues,
          completedAt: data.completedAt
        };
      } catch (error) {
        console.error('Failed to parse median task data:', error);
      }
    }

    return null;
  }
}
