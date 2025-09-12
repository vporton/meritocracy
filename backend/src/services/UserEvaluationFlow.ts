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
   * 
   * Flow according to diagram:
   * 1. Scientist Onboarding → First Worth Assessment → Median Calculation
   * 2. Scientist Onboarding → Prompt Injection Check → Second Worth Assessment (if no injection) → Median Calculation
   * 3. Scientist Onboarding → Prompt Injection Check → Third Worth Assessment (if no injection) → Median Calculation
   */
  async createEvaluationFlow(evaluationData: UserEvaluationData) {
    console.log(`🔄 Creating evaluation flow for user ${evaluationData.userId}`);

    // Step 1: Create the initial scientist check task
    const scientistOnboardingTask = await this.createScientistOnboardingTask(evaluationData);
    
    // Step 2: Create the three worth assessment paths
    const worthPaths = await this.createWorthAssessmentPaths(evaluationData, [scientistOnboardingTask.id]);
    
    // Step 3: Create median task that depends on all worth assessment tasks
    const allWorthTaskIds = worthPaths.map(path => path.worthTask.id);
    const medianTask = await this.createMedianTask(evaluationData, allWorthTaskIds);
    
    console.log(`✅ Evaluation flow created with root task ${scientistOnboardingTask.id}`);
    console.log(`📊 Flow structure: 1 direct worth task + 2 injection check → worth assessment → median`);
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
   * Create the three worth assessment paths as shown in the diagram
   * 1. First path: Direct worth assessment → median
   * 2. Second path: Worth assessment → prompt injection checks → worth assessment → median
   * 3. Third path: Worth assessment → prompt injection checks → worth assessment → median
   */
  private async createWorthAssessmentPaths(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const paths = [];
    
    // First path: Direct worth assessment (no injection checks)
    const firstRandomizeTask = await this.createRandomizePromptTask(evaluationData, dependencies, worthPrompt);
    const firstWorthTask = await this.createWorthAssessmentTask(evaluationData, [firstRandomizeTask.id]);
    
    paths.push({
      randomizeTask: firstRandomizeTask,
      worthTask: firstWorthTask,
      pathType: 'direct'
    });
    
    // Second and third paths: Worth assessment → prompt injection checks → worth assessment
    for (let pathIndex = 1; pathIndex < 3; pathIndex++) {
      // First worth assessment in this path
      const firstWorthRandomizeTask = await this.createRandomizePromptTask(evaluationData, dependencies, worthPrompt);
      const firstWorthTask = await this.createWorthAssessmentTask(evaluationData, [firstWorthRandomizeTask.id]);
      
      // Create prompt injection check flow (6 sequential tasks)
      const injectionFlow = await this.createPromptInjectionFlow(evaluationData, [firstWorthTask.id]);
      
      // Second worth assessment after injection checks
      const secondWorthRandomizeTask = await this.createRandomizePromptTask(evaluationData, injectionFlow.completionTasks, worthPrompt);
      const secondWorthTask = await this.createWorthAssessmentTask(evaluationData, [secondWorthRandomizeTask.id]);
      
      paths.push({
        firstWorthRandomizeTask,
        firstWorthTask,
        injectionFlow,
        secondWorthRandomizeTask,
        worthTask: secondWorthTask, // This is the final worth task for this path
        pathType: 'with_injection_checks' // TODO: superfluous
      });
    }
    
    return paths;
  }

  /**
   * Create sequential prompt injection check flow (6 tasks total)
   * According to diagram: 3 pairs of "Randomize prompt" → "Randomized" tasks
   * Each pair can result in ban if injection detected, or continue to next pair
   */
  private async createPromptInjectionFlow(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const injectionTasks = [];
    let currentDependencies = dependencies;
    
    // Create 3 pairs of injection check tasks (6 tasks total)
    for (let pairIndex = 0; pairIndex < 3; pairIndex++) {
      // Create randomize prompt task for injection check
      const randomizeTask = await this.createRandomizePromptTask(
        evaluationData, 
        currentDependencies, 
        injectionPrompt
      );
      
      // Create injection detection task
      const injectionTask = await this.prisma.task.create({
        data: {
          status: TaskStatus.PENDING,
          runnerClassName: 'PromptInjectionRunner',
          runnerData: JSON.stringify({
            userId: evaluationData.userId,
            userData: evaluationData.userData,
            checkNumber: pairIndex + 1,
            banDuration: '1y',
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
        injectionTask,
        pairIndex: pairIndex + 1
      });
      
      // Next pair depends on current injection task
      currentDependencies = [injectionTask.id];
    }

    return {
      injectionTasks,
      completionTasks: injectionTasks.map(t => t.injectionTask.id) // Tasks that must complete before median
    };
  }



  /**
   * Create median calculation task
   * This corresponds to "Salary = the median" in the diagram
   * It depends on all three worth assessment tasks (one from each path)
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
