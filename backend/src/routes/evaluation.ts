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
    if (userData.onboarded) {
      return res.status(400).json({
        error: 'User is already onboarded'
      });
    }

    // Create the evaluation flow service
    const evaluationFlow = new UserEvaluationFlow(prisma);
    
    // Create the evaluation flow
    const _rootTaskId = await evaluationFlow.createOnboardingFlow({
      userId,
      userData
    });

    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true }
    });

    const taskManager = new TaskManager(prisma);
    const success = await taskManager.runAllPendingTasks();

    return res.json({
      success: true,
      message: 'Evaluation flow started',
      userId,
      executed: success
    });

  } catch (error) {
    console.error('Error starting evaluation:', error);
    return res.status(500).json({
      error: 'Failed to start evaluation',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// TODO@P2: Shouldn't be a public endpoint.
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

export default router;
