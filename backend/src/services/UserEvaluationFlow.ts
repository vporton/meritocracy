import { PrismaClient, Task } from '@prisma/client';
import { TaskStatus } from '../types/task.js';
import { worthPrompt, injectionPrompt } from '../prompts.js';
import { GlobalDataService } from './GlobalDataService.js';

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
   * 1. Scientist Onboarding → First Worth Assessment → WorthThresholdCheckRunner
   * 2. If worth > 1e-11: WorthThresholdCheckRunner → Prompt Injection Checks → Second and Third Worth Assessment → Median
   * 3. If worth <= 1e-11: WorthThresholdCheckRunner → Median (directly)
   */
  async createOnboardingFlow(evaluationData: UserEvaluationData) {
    console.log(`🔄 Creating onboarding flow for user ${evaluationData.userId}`);

    // Step 1: Create the initial scientist check task
     const scientistOnboardingTask = await this.createScientistOnboardingTask(evaluationData);
    
    return this.createEvaluationFlow(evaluationData, scientistOnboardingTask);
  }

  /**
   * Create the flow graph for user evaluation
   * Returns the root task ID that can be used to start the evaluation
   * 
   * Flow according to diagram:
   * 1. First Worth Assessment → WorthThresholdCheckRunner
   * 2. If worth > 1e-11: WorthThresholdCheckRunner → Prompt Injection Checks → Second and Third Worth Assessment → Median
   * 3. If worth <= 1e-11: WorthThresholdCheckRunner → Median (directly)
   */
  async createEvaluationFlow(evaluationData: UserEvaluationData, scientistOnboardingTask?: Task) {
    console.log(`🔄 Creating evaluation flow for user ${evaluationData.userId}`);

    // Step 2: Create the first worth assessment task
    const worthPromptWithGdp = await this.getWorthPromptWithGdp();
    const firstWorthRandomizeTask = await this.createRandomizePromptTask(
      evaluationData,
      scientistOnboardingTask !== undefined ? [scientistOnboardingTask.id] : [],
      worthPromptWithGdp
    );
    const firstWorthTask = await this.createWorthAssessmentTask(evaluationData, [firstWorthRandomizeTask.id]);
    
    // Step 3: Create the worth threshold check task
    const thresholdCheckTask = await this.createWorthThresholdCheckTask(evaluationData, [firstWorthTask.id]);
    
    // Step 4: Create the prompt injection check flow (only if threshold is exceeded)
    const injectionFlow = await this.createPromptInjectionFlow(evaluationData, [thresholdCheckTask.id]);
    
    // Step 5: Create the second worth assessment task (after injection checks)
    const secondWorthRandomizeTask = await this.createRandomizePromptTask(evaluationData, injectionFlow.completionTasks, worthPromptWithGdp);
    const secondWorthTask = await this.createWorthAssessmentTask(evaluationData, [secondWorthRandomizeTask.id]);
    
    // Step 6: Create the third worth assessment task (only if injection checks pass)
    const thirdWorthRandomizeTask = await this.createRandomizePromptTask(evaluationData, injectionFlow.completionTasks, worthPromptWithGdp);
    const thirdWorthTask = await this.createWorthAssessmentTask(evaluationData, [thirdWorthRandomizeTask.id]);
    
    // Step 7: Create median task that depends on all worth assessment tasks
    // Note: The median task will process available worth values even if some dependencies are cancelled
    const medianTask = await this.createMedianTask(evaluationData, [firstWorthTask.id, secondWorthTask.id, thirdWorthTask.id]);
    
    console.log(`✅ Evaluation flow created with root task ${scientistOnboardingTask?.id || 'N/A'}`);
    console.log(`📊 Flow structure: Scientist → Worth → Threshold Check → [Injection Checks] → Worth → Median`);
    console.log(`📊 Both Second and Third Worth Assessments depend on injection checks passing`);
    return scientistOnboardingTask?.id || firstWorthTask.id;
  }

  /**
   * Create the initial scientist check task
   */
  private async createScientistOnboardingTask(evaluationData: UserEvaluationData) {
    return await this.prisma.task.create({
      data: {
        status: TaskStatus.NOT_STARTED,
        runnerClassName: 'ScientistOnboardingRunner',
        runnerData: JSON.stringify({
          userData: evaluationData.userData
        })
      }
    });
  }

  /**
   * Get the worth prompt with current GDP data
   */
  private async getWorthPromptWithGdp(): Promise<string> {
    try {
      let worldGdp = await GlobalDataService.getWorldGdp();
      
      // If GDP data is not available, attempt to fetch and update it
      if (!worldGdp) {
        console.log('World GDP data not available, attempting to fetch...');
        const fetchSuccess = await GlobalDataService.fetchAndUpdateWorldGdp();
        if (fetchSuccess) {
          worldGdp = await GlobalDataService.getWorldGdp();
        }
      }
      
      if (worldGdp) {
        return worthPrompt.replace('<WORLD_GDP>', worldGdp.toLocaleString());
      } else {
        throw Error('World GDP not available');
      }
    } catch (error) {
      console.error('Error fetching world GDP for prompt:', error);
      return worthPrompt.replace('<WORLD_GDP>', 'Not available');
    }
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
        status: TaskStatus.NOT_STARTED,
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
        status: TaskStatus.NOT_STARTED,
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
   * Create a worth threshold check task
   * This corresponds to "Compare user worth (WorthThresholdCheckRunner) to 1e-11" in the diagram
   */
  private async createWorthThresholdCheckTask(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.NOT_STARTED,
        runnerClassName: 'WorthThresholdCheckRunner',
        runnerData: JSON.stringify({
          userId: evaluationData.userId,
          threshold: 1e-11 // Default threshold from the diagram
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
   * Create sequential prompt injection check flow (6 tasks total)
   * According to diagram: 3 pairs of "Randomize prompt" → "Randomized" tasks
   * Each pair can result in ban if injection detected, or continue to next pair
   */
  private async createPromptInjectionFlow(
    evaluationData: UserEvaluationData,
    dependencies: number[]
  ) {
    const injectionTasks: any = []; // TODO@P3: type
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
          status: TaskStatus.NOT_STARTED,
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
        status: TaskStatus.NOT_STARTED,
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
