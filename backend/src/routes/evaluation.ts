import express from 'express';
import { UserEvaluationFlow } from '../services/UserEvaluationFlow.js';
import { TaskExecutor } from '../services/TaskExecutor.js';
import { TaskManager } from '../services/TaskManager.js';
import { registerAllRunners } from '../runners/OpenAIRunners.js';
import { requireAuth, requireAdditionalConnections } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { startApiSelfKeepAlive } from '../services/SelfPingKeepAlive.js';

const router = express.Router();

// Register TaskRunners
registerAllRunners();

/**
 * POST /api/evaluation/start
 * Start a user evaluation flow
 */
router.post('/start', requireAuth, requireAdditionalConnections, async (req, res) => {
  try {
    const userId = (req as any).userId; // Get from authenticated session
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        emails: {
          where: {
            verified: true
          },
          select: {
            email: true,
            verified: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    if (user.onboarded) {
      return res.status(400).json({
        error: 'User is already onboarded'
      });
    }

    if (user.evaluationBlockedTill && user.evaluationBlockedTill > new Date()) {
      const blockedReason = user.evaluationBlockReason === 'CRACKPOT'
        ? 'the previous evaluation identified the user as a crackpot'
        : 'the previous evaluation was unsuccessful';
      return res.status(403).json({
        error: 'Evaluation is temporarily blocked',
        message: `Re-evaluation is unavailable until ${user.evaluationBlockedTill.toISOString()} because ${blockedReason}.`,
        evaluationBlockedTill: user.evaluationBlockedTill.toISOString(),
        evaluationBlockReason: user.evaluationBlockReason
      });
    }

    // Onboarding evaluation can run longer than normal HTTP idle limits on Fly.io.
    const stopKeepAlive = startApiSelfKeepAlive('user onboarding evaluation');

    try {
      // Create the evaluation flow service
      const evaluationFlow = new UserEvaluationFlow(prisma);

      // Create the evaluation flow
      const _rootTaskId = await evaluationFlow.createOnboardingFlow({
        userId,
        userData: {
          orcidId: user.orcidId || undefined,
          githubHandle: user.githubHandle || undefined,
          bitbucketHandle: user.bitbucketHandle || undefined,
          gitlabHandle: user.gitlabHandle || undefined,
          ethereumAddress: user.ethereumAddress || undefined,
          name: user.name || undefined,
          email: user.email || undefined,
          emailVerified: user.emailVerified,
          emails: user.emails
        }
      });

      const taskManager = new TaskManager(prisma);
      const success = await taskManager.runAllPendingTasks();

      return res.json({
        success: true,
        message: 'Evaluation flow started',
        userId,
        executed: success
      });
    } finally {
      stopKeepAlive();
    }

  } catch (error) {
    console.error('Error starting evaluation:', error);
    return res.status(500).json({
      error: 'Failed to start evaluation',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
