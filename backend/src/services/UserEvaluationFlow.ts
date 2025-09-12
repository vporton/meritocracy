import { PrismaClient } from '@prisma/client';
import { TaskStatus } from '../types/task.js';
import { worthPrompt, injectionPrompt } from '../prompts.js';

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
  async createEvaluationFlow(evaluationData: UserEvaluationData) {
    console.log(`🔄 Creating evaluation flow for user ${evaluationData.userId}`);

    // Step 1: Create the initial scientist check task
    const scientistOnboardingTask = await this.createScientistOnboardingTask(evaluationData);
    
    // Step 2: Create the three worth assessment tasks (as per diagram)
    const worthTasks = await this.createWorthTasks(evaluationData, [scientistOnboardingTask.id]);
    
    // Step 3: Create prompt injection detection tasks connected to worth evaluations
    const injectionTasks = await this.createPromptInjectionFlow(evaluationData, worthTasks);
    
    // Step 4: Create the final median calculation task that depends on all worth tasks
    const allWorthTaskIds = worthTasks.map(t => t.worthTask.id);
    const medianTask = await this.createMedianTask(evaluationData, allWorthTaskIds);
    
    console.log(`✅ Evaluation flow created with root task ${scientistOnboardingTask.id}`);
    return scientistOnboardingTask.id;
  }

  /**
   * Create the initial scientist check task
   */
  private async createScientistOnboardingTask(evaluationData: UserEvaluationData) {
    return await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'ScientistOnboardingRunner',
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
    dependencies: number[],
    originalPrompt: string = worthPrompt,
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.PENDING,
        runnerClassName: 'RandomizePromptRunner',
        runnerData: JSON.stringify({
          originalPrompt,
          userData: evaluationData.userData,
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
   * Create the three worth assessment tasks
   * These correspond to the worth evaluation tasks in the diagram that converge to median
   */
  private async createWorthTasks(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const tasks = [];
    
    // Create 3 worth assessment tasks
    for (let i = 0; i < 3; i++) {
      // Create randomization task for each worth assessment
      const randomizeTask = await this.createRandomizePromptTask(evaluationData, dependencies);
      
      // Create worth assessment task that depends on randomization
      const worthTask = await this.createWorthAssessmentTask(evaluationData, [randomizeTask.id]);
      
      tasks.push({
        randomizeTask,
        worthTask
      });
    }
    
    return tasks;
  }

  /**
   * Create prompt injection detection flow connected to worth evaluations
   * This implements the right side of the diagram where worth evaluations > 1e-11
   * trigger prompt injection checks, and detection leads to 1-year ban
   */
  private async createPromptInjectionFlow(
    evaluationData: UserEvaluationData,
    worthTasks: Array<{randomizeTask: any, worthTask: any}>
  ) {
    const injectionTasks = [];
    
    // Create 3 prompt injection check tasks
    for (let i = 0; i < 3; i++) {
      // Each injection check depends on a specific worth evaluation
      // The diagram shows connections from worth evaluations to injection checks
      const worthTask = worthTasks[i]?.worthTask;
      const dependencies = worthTask ? [worthTask.id] : [];
      
      // Create randomization task for prompt injection check
      const randomizeTask = await this.createRandomizePromptTask(evaluationData, dependencies, injectionPrompt);
      
      // Create the prompt injection detection task
      // This task handles both detection and ban (1 year) if injection is found
      const injectionTask = await this.prisma.task.create({
        data: {
          status: TaskStatus.PENDING,
          runnerClassName: 'PromptInjectionRunner',
          runnerData: JSON.stringify({
            userId: evaluationData.userId,
            userData: evaluationData.userData,
            checkNumber: i + 1,
            threshold: 1e-11, // Check if worth > 1e-11 before running injection check
            banDuration: '1y', // Ban for 1 year if injection detected
            banReason: 'Prompt injection detected'
          })
        }
      });

      // Create dependency on the randomization task
      await this.prisma.taskDependency.create({
        data: {
          taskId: injectionTask.id,
          dependencyId: randomizeTask.id
        }
      });

      injectionTasks.push({
        randomizeTask,
        injectionTask
      });
    }

    return injectionTasks;
  }



  /**
   * Create median calculation task
   * This corresponds to "Salary = the median" in the diagram
   * It converges all worth evaluation results
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
          userId: evaluationData.userId,
          sourceTaskIds: worthTaskIds // Track which tasks contribute to the median
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
