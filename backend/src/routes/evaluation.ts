import express from 'express';
import { PrismaClient } from '@prisma/client';
import { UserEvaluationFlow } from '../services/UserEvaluationFlow.js';
import { TaskExecutor } from '../services/TaskExecutor.js';
import { TaskManager } from '../services/TaskManager.js';
import { registerAllRunners } from '../runners/OpenAIRunners.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Register TaskRunners
registerAllRunners();

/**
 * POST /api/evaluation/start
 * Start a user evaluation flow
 */
router.post('/start', requireAuth, async (req, res) => {
  try {
    const { userData } = req.body;
    const userId = (req as any).userId; // Get from authenticated session

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

    const taskManager = new TaskManager(prisma);
    const success = await taskManager.runAllPendingTasks();

    // Execute non-batch mode tasks if applicable
    const taskExecutor = new TaskExecutor(prisma);
    const executed = await taskExecutor.executeNonBatchMode(rootTaskId);

    return res.json({
      success: true,
      message: 'Evaluation flow started',
      userId,
      rootTaskId,
      executed
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
 * GET /api/evaluation/result
 * Get the evaluation result for the authenticated user
 */
router.get('/result', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId; // Get from authenticated session

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
 * GET /api/evaluation/status
 * Get the status of evaluation tasks for the authenticated user
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId; // Get from authenticated session

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
