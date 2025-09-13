import express from 'express';
import { PrismaClient } from '@prisma/client';
import { UserEvaluationFlow } from '../services/UserEvaluationFlow.js';
import { TaskExecutor } from '../services/TaskExecutor.js';
import { TaskManager } from '../services/TaskManager.js';
import { registerAllRunners } from '../runners/OpenAIRunners.js';
import { createAIBatchStore, createAIOutputter } from '@/services/openai.js';
import { TaskRunnerRegistry, TaskStatus } from '../types/task.js';

const router = express.Router();
const prisma = new PrismaClient();

// Register TaskRunners
registerAllRunners();

/**
 * POST /api/evaluation/start
 * Start a user evaluation flow
 */
router.post('/start', async (req, res) => {
  try {
    const { userId, userData } = req.body; // FIXME: insecure

    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required'
      });
    }

    if (!userData) {
      return res.status(400).json({
        error: 'User data is required'
      });
    }

    // Create the evaluation flow service
    const evaluationFlow = new UserEvaluationFlow(prisma);
    
    // Create the evaluation flow
    const rootTaskId = await evaluationFlow.createOnboardingFlow({
      userId,
      userData
    });

    const pendingTasks = await prisma.task.findMany({select: {id: true}, where: {status: TaskStatus.PENDING}}); // FIXME: What to do with IN_PROGRESS?
    for (const task of pendingTasks) {
      await TaskRunnerRegistry.runByTaskId(prisma, task.id);
    }
    
    // Check OPENAI_FLEX_MODE and run tasks if non-batch
    const openAIFlexMode = process.env.OPENAI_FLEX_MODE as 'batch' | 'nonbatch';
    
    if (openAIFlexMode === 'nonbatch' && rootTaskId) { // TODO: hack
      console.log(`🚀 OPENAI_FLEX_MODE is non-batch, running task ${rootTaskId} with dependencies`);
      const taskManager = new TaskManager(prisma);
      const results = await taskManager.runAllPendingTasks();
      
      console.log(`✅ Task execution completed: ${results.executed} executed, ${results.failed} failed, ${results.skipped} skipped`);

      // Get all completed tasks for this user to retrieve their outputs
      const completedTasks = await prisma.task.findMany({
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

      console.log(`📊 Found ${completedTasks.length} completed tasks for user ${userId}`);
      
      // Call outputter multiple times to get results from each completed task
      const taskResults = [];
      for (const task of completedTasks) {
        try {
          if (task.runnerData) {
            const taskData = JSON.parse(task.runnerData);
            const customId = taskData.customId; // TODO: Store it in  a model field, instead.
            
            if (customId) {
              // Get the storeId from the openAILog table
              const openAILog = await prisma.openAILog.findFirst({
                where: { customId },
                select: { storeId: true }
              });
              
              // FIXME: Wrong way to get `storeId`.
              if (openAILog?.storeId) {
                console.log(`🔍 Getting output for task ${task.id} with customId: ${customId}, storeId: ${openAILog.storeId}`);
                
                // Create the store and outputter with the correct storeId
                const store = await createAIBatchStore(openAILog.storeId);
                const outputter = await createAIOutputter(store);
                
                const output = await outputter.getOutput(customId);
                taskResults.push({
                  taskId: task.id,
                  customId,
                  storeId: openAILog.storeId,
                  output,
                  completedAt: task.completedAt
                });
              } else {
                console.warn(`⚠️ No storeId found for task ${task.id} with customId: ${customId}`);
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error getting output for task ${task.id}:`, error);
        }
      }
      
      console.log(`📈 Retrieved outputs for ${taskResults.length} tasks`);
    } else {
      console.log(`📋 OPENAI_FLEX_MODE is batch, task ${rootTaskId} queued for batch processing`);
    }

    return res.json({
      success: true,
      message: 'Evaluation flow started',
      userId,
      rootTaskId,
      executed: openAIFlexMode === 'nonbatch'
    });

  } catch (error) {
    console.error('Error starting evaluation:', error);
    return res.status(500).json({
      error: 'Failed to start evaluation',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// TODO: Shouldn't be a public endpoint.
/**
 * POST /api/evaluation/execute
 * Execute ready tasks in the evaluation flow
 */
router.post('/execute', async (req, res) => {
  try {
    const taskExecutor = new TaskExecutor(prisma);
    const executedCount = await taskExecutor.executeReadyTasks();

    return res.json({
      success: true,
      message: 'Tasks executed',
      executedCount
    });

  } catch (error) {
    console.error('Error executing tasks:', error);
    return res.status(500).json({
      error: 'Failed to execute tasks',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// TODO: Don't depend on this endpoint: The data will be removed.
/**
 * GET /api/evaluation/result/:userId
 * Get the evaluation result for a user
 */
router.get('/result/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const evaluationFlow = new UserEvaluationFlow(prisma);
    const result = await evaluationFlow.getEvaluationResult(userId);

    if (!result) {
      return res.status(404).json({
        error: 'No evaluation result found for this user'
      });
    }

    return res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error('Error getting evaluation result:', error);
    return res.status(500).json({
      error: 'Failed to get evaluation result',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// TODO: Don't depend on this endpoint: The data will be removed.
/**
 * GET /api/evaluation/status/:userId
 * Get the status of evaluation tasks for a user
 */
router.get('/status/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (isNaN(userId)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    // Find all tasks related to this user
    const tasks = await prisma.task.findMany({
      where: {
        runnerData: {
          contains: `"userId":${userId}`
        }
      },
      include: {
        dependencies: {
          include: {
            dependency: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Group tasks by type
    const taskGroups = {
      scientistCheck: tasks.filter(t => t.runnerClassName === 'ScientistOnboardingRunner'),
      worthAssessment: tasks.filter(t => t.runnerClassName === 'WorthAssessmentRunner'),
      promptInjection: tasks.filter(t => t.runnerClassName === 'PromptInjectionRunner'),
      worthThresholdCheck: tasks.filter(t => t.runnerClassName === 'WorthThresholdCheckRunner'),
      median: tasks.filter(t => t.runnerClassName === 'MedianRunner'),
      ban: tasks.filter(t => t.runnerClassName === 'BanUserRunner')
    };

    return res.json({
      success: true,
      userId,
      totalTasks: tasks.length,
      taskGroups,
      tasks: tasks.map(task => ({
        id: task.id,
        status: task.status,
        runnerClassName: task.runnerClassName,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        dependencies: task.dependencies.map(dep => dep.dependencyId)
      }))
    });

  } catch (error) {
    console.error('Error getting evaluation status:', error);
    return res.status(500).json({
      error: 'Failed to get evaluation status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
