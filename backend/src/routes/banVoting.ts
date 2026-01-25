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
        const { targetUserId, message } = req.body;

        if (!targetUserId) {
            res.status(400).json({ error: 'Missing targetUserId' });
            return;
        }

        if (voterId === Number(targetUserId)) {
            res.status(400).json({ error: 'You cannot vote to ban yourself' });
            return;
        }

        const vote = await BanVotingService.submitBanVote(voterId, Number(targetUserId), message);

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

        res.status(500).json({ error: error.message || 'Failed to submit vote' });
    }
});

// Get AI assessments for a specific user
router.get('/:userId/assessments', async (req, res): Promise<void> => {
    try {
        const targetId = Number(req.params.userId);
        const assessments = await BanVotingService.getUserAssessments(targetId);
        res.json(assessments);
    } catch (error: any) {
        console.error('Error fetching assessments:', error);
        res.status(500).json({ error: 'Failed to fetch assessments' });
    }
});

// Get votes for a specific user (optional, maybe for detail view)

export default router;
