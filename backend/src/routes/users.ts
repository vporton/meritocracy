import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, getCurrentUserFromToken } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Remove duplicate auth middleware - now imported from shared module

// GET /api/users - Get all users
router.get('/', async (req, res): Promise<void> => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/leaderboard - Get GDP share leaderboard
router.get('/leaderboard', async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100); // Max 100 users
    
    const users = await prisma.user.findMany({
      where: {
        shareInGDP: {
          not: null
        }
      },
      select: {
        id: true,
        name: true,
        shareInGDP: true,
        // Don't include email for privacy
      },
      orderBy: {
        shareInGDP: 'desc'
      },
      take: limit
    });

    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      userId: user.id,
      name: user.name || `User ${user.id}`,
      shareInGDP: user.shareInGDP!,
    }));

    res.json({ 
      success: true, 
      data: {
        leaderboard,
        total: leaderboard.length,
        limit
      }
    });
  } catch (error: any) {
    console.error('Error fetching GDP leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch GDP leaderboard' });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id) },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error: any) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /api/users/me/gdp-share - Get current user's GDP share
router.get('/me/gdp-share', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        shareInGDP: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.shareInGDP === null) {
      res.json({ 
        success: true, 
        message: 'No GDP share assigned yet',
        data: {
          userId: user.id,
          name: user.name,
          email: user.email,
          shareInGDP: null
        }
      });
      return;
    }

    res.json({ 
      success: true, 
      data: {
        userId: user.id,
        name: user.name,
        email: user.email,
        shareInGDP: user.shareInGDP,
        value: user.shareInGDP
      }
    });
  } catch (error: any) {
    console.error('Error fetching user GDP share:', error);
    res.status(500).json({ error: 'Failed to fetch user GDP share' });
  }
});

// POST /api/users - Create new user
router.post('/', async (req, res): Promise<void> => {
  try {
    const { email, name } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
      },
    });

    res.status(201).json(user);
  } catch (error: any) {
    console.error('Error creating user:', error);
    if ((error as any).code === 'P2002') {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id - Update user
router.put('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const { email, name, solanaAddress, bitcoinAddress, polkadotAddress, cosmosAddress } = req.body;
    const authenticatedUserId = (req as any).userId;

    // Check if user is trying to update their own account
    if (parseInt(id) !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only update your own account' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        ...(email && { email }),
        ...(name !== undefined && { name }),
        ...(solanaAddress !== undefined && { solanaAddress: solanaAddress?.trim() ? solanaAddress.trim() : null }),
        ...(bitcoinAddress !== undefined && { bitcoinAddress: bitcoinAddress?.trim() ? bitcoinAddress.trim() : null }),
        ...(polkadotAddress !== undefined && { polkadotAddress: polkadotAddress?.trim() ? polkadotAddress.trim() : null }),
        ...(cosmosAddress !== undefined && { cosmosAddress: cosmosAddress?.trim() ? cosmosAddress.trim() : null }),
      },
    });

    res.json(user);
  } catch (error: any) {
    console.error('Error updating user:', error);
    if ((error as any).code === 'P2025') {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if ((error as any).code === 'P2002') {
      res.status(400).json({ error: 'Email already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id - Delete user
router.delete('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const authenticatedUserId = (req as any).userId;

    // Check if user is trying to delete their own account
    if (parseInt(id) !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
      return;
    }

    await prisma.user.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting user:', error);
    if ((error as any).code === 'P2025') {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
