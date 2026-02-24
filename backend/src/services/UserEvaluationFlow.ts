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
   * Flow according to new diagram:
   * 1. Actor → gpt-5-mini Assessment (scientist check)
   * 2. Bi-monthly trigger → Sequential randomization and assessment pairs
   * 3. Each pair: Randomize → Randomized (can lead to ban or median)
   */
  async createOnboardingFlow(evaluationData: UserEvaluationData) {
    console.log(`🔄 Creating onboarding flow for user ${evaluationData.userId}`);

    // Step 1: Create the initial scientist check task
    const scientistOnboardingTask = await this.createScientistOnboardingTask(evaluationData);

    return this.createEvaluationFlow(evaluationData, scientistOnboardingTask);
  }

  /**
   * Create the flow graph for user evaluation according to the new diagram
   * Returns the root task ID that can be used to start the evaluation
   * 
   * Flow strategy:
   * 1. First run: 3 worth assessments (median from same run)
   * 2. Subsequent runs: 1 new worth assessment (median from latest 3 total, including history)
   * 3. Prompt injection checks remain in the flow for each run
   */
  async createEvaluationFlow(evaluationData: UserEvaluationData, scientistOnboardingTask?: Task) {
    console.log(`🔄 Creating evaluation flow for user ${evaluationData.userId}`);

    const worthPromptWithGdp = await this.getWorthPromptWithGdp();
    const hasPreviousWorthAssessments = await this.hasPreviousWorthAssessments(evaluationData.userId);
    const worthTasks: number[] = [];
    const initialDependencies = scientistOnboardingTask ? [scientistOnboardingTask.id] : [];

    // Pair 1: Worth assessment
    const pair1Randomize = await this.createRandomizePromptTask(
      evaluationData,
      initialDependencies,
      worthPromptWithGdp
    );
    const pair1Worth = await this.createWorthAssessmentTask(evaluationData, [pair1Randomize.id]);
    worthTasks.push(pair1Worth.id);

    if (hasPreviousWorthAssessments) {
      // Subsequent runs: one worth assessment plus one injection check.
      const pair2Randomize = await this.createRandomizePromptTask(evaluationData, [pair1Worth.id], injectionPrompt);
      await this.createPromptInjectionTask(evaluationData, [pair2Randomize.id, pair1Worth.id], 1);
      await this.createMedianTask(evaluationData, worthTasks);

      console.log(`✅ Evaluation flow created with root task ${scientistOnboardingTask?.id || 'N/A'}`);
      console.log(`📊 Flow structure: ${scientistOnboardingTask ? 'Scientist → ' : ''}1 worth + 1 injection → Median(using latest 3 worth assessments)`);
      return scientistOnboardingTask?.id || pair1Randomize.id;
    }

    // First run: keep 3 worth assessments and 3 injection checks for bootstrap median.
    const pair2Randomize = await this.createRandomizePromptTask(evaluationData, [pair1Worth.id], injectionPrompt);
    const pair2Injection = await this.createPromptInjectionTask(evaluationData, [pair2Randomize.id, pair1Worth.id], 1);

    const pair3Randomize = await this.createRandomizePromptTask(evaluationData, [pair2Injection.id], worthPromptWithGdp);
    const pair3Worth = await this.createWorthAssessmentTask(evaluationData, [pair3Randomize.id]);
    worthTasks.push(pair3Worth.id);

    const pair4Randomize = await this.createRandomizePromptTask(evaluationData, [pair3Worth.id], injectionPrompt);
    const pair4Injection = await this.createPromptInjectionTask(evaluationData, [pair4Randomize.id, pair1Worth.id, pair3Worth.id], 2);

    const pair5Randomize = await this.createRandomizePromptTask(evaluationData, [pair4Injection.id], worthPromptWithGdp);
    const pair5Worth = await this.createWorthAssessmentTask(evaluationData, [pair5Randomize.id]);
    worthTasks.push(pair5Worth.id);

    const pair6Randomize = await this.createRandomizePromptTask(evaluationData, [pair5Worth.id], injectionPrompt);
    await this.createPromptInjectionTask(evaluationData, [pair6Randomize.id, pair1Worth.id, pair3Worth.id, pair5Worth.id], 3);

    await this.createMedianTask(evaluationData, worthTasks);

    console.log(`✅ Evaluation flow created with root task ${scientistOnboardingTask?.id || 'N/A'}`);
    console.log(`📊 Flow structure: ${scientistOnboardingTask ? 'Scientist → ' : ''}6 sequential pairs (3 worth + 3 injection) → Median`);
    console.log(`📊 Each injection check can lead to ban, each worth assessment contributes to median`);
    return scientistOnboardingTask?.id || pair1Randomize.id;
  }

  private async hasPreviousWorthAssessments(userId: number): Promise<boolean> {
    const worthAssessmentCount = await this.prisma.task.count({
      where: {
        runnerClassName: 'WorthAssessmentRunner',
        isDeleted: false,
        runnerData: {
          contains: `"userId":${userId},`
        }
      }
    });

    return worthAssessmentCount > 0;
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
          userId: evaluationData.userId,
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
          userId: evaluationData.userId,
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
        isNeverDeleted: true,
        runnerData: JSON.stringify({
          userId: evaluationData.userId,
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
   * Create a single prompt injection check task
   * This corresponds to "Randomized: Is there a prompt injection?" in the diagram
   */
  private async createPromptInjectionTask(
    evaluationData: UserEvaluationData,
    dependencies: number[],
    checkNumber: number
  ) {
    const task = await this.prisma.task.create({
      data: {
        status: TaskStatus.NOT_STARTED,
        runnerClassName: 'PromptInjectionRunner',
        runnerData: JSON.stringify({
          userId: evaluationData.userId,
          userData: evaluationData.userData,
          checkNumber: checkNumber,
          banDuration: '1y',
          banReason: 'Prompt injection detected'
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
   * This corresponds to "Salary = the median" in the diagram
   * It depends on current-run worth assessment tasks.
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
        status: TaskStatus.COMPLETED,
        isDeleted: false
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
