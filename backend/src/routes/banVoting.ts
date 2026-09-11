import express from 'express';
import { BanVotingService } from '../services/BanVotingService.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get list of evaluated users with their vote stats for the current week
router.get('/', async (req, res): Promise<void> => {
    try {
        const users = await BanVotingService.getEvaluatedUsersWithVoteStats();
        res.json(users);
    } catch (error: any) {
        console.error('Error fetching ban voting data:', error);
        res.status(500).json({ error: 'Failed to fetch ban voting data' });
    }
});

// Submit a ban vote
router.post('/vote', requireAuth, async (req, res): Promise<void> => {
    try {
        const voterId = (req as any).userId;
        const { targetUserId, message, type } = req.body;

        const parsedTargetUserId = Number(targetUserId);
        if (!Number.isSafeInteger(parsedTargetUserId) || parsedTargetUserId < 1) {
            res.status(400).json({ error: 'Missing targetUserId' });
            return;
        }

        if (message !== undefined && (typeof message !== 'string' || message.length > 2000)) {
            res.status(400).json({ error: 'Message must be a string of at most 2000 characters' });
            return;
        }
        const normalizedMessage = typeof message === 'string' ? message : '';

        if (type && type !== 'BAN' && type !== 'UNBAN') {
            res.status(400).json({ error: 'Invalid vote type. Must be BAN or UNBAN.' });
            return;
        }

        if (voterId === parsedTargetUserId) {
            res.status(400).json({ error: 'You cannot vote to ban yourself' });
            return;
        }

        const vote = await BanVotingService.submitBanVote(voterId, parsedTargetUserId, normalizedMessage, type as 'BAN' | 'UNBAN');

        res.status(201).json({
            message: 'Vote submitted successfully',
            vote
        });
    } catch (error: any) {
        console.error('Error submitting ban vote:', error);

        if (error.message.includes('not authorized')) {
            res.status(403).json({ error: error.message });
            return;
        }
        if (error.message.includes('already voted')) {
            res.status(409).json({ error: error.message }); // Conflict
            return;
        }

        res.status(500).json({ error: 'Failed to submit vote' });
    }
});

// Get AI assessments for a specific user
router.get('/:userId/assessments', async (req, res): Promise<void> => {
    try {
        const targetId = Number(req.params.userId);
        const page = Number(req.query.page) || 1;
        const pageSize = Number(req.query.pageSize) || 3;
        if (!Number.isSafeInteger(targetId) || targetId < 1 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
            res.status(400).json({ error: 'Invalid pagination or user ID' });
            return;
        }
        const assessments = await BanVotingService.getUserAssessmentsPaginated(targetId, { page, pageSize });
        res.json(assessments);
    } catch (error: any) {
        console.error('Error fetching assessments:', error);
        res.status(500).json({ error: 'Failed to fetch assessments' });
    }
});

// Get votes for a specific user (optional, maybe for detail view)

export default router;
