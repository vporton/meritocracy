import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isValidEthereumAddress, validateNonEvmAddresses } from '../utils/addressValidation.js';
import { softDeleteUser } from '../services/userDeletionUtils.js';
import { prisma } from '../lib/prisma.js';
import { normalizeEmail, syncPrimaryEmail } from '../services/userEmailUtils.js';

const router = express.Router();

// Remove duplicate auth middleware - now imported from shared module

type LeaderboardUser = {
  id: number;
  name: string | null;
};

type UpdateUserBody = {
  email?: string | null;
  name?: string | null;
  ethereumAddress?: string | null;
  solanaAddress?: string | null;
  bitcoinAddress?: string | null;
  bitcoinCashAddress?: string | null;
  polkadotAddress?: string | null;
  cosmosAddress?: string | null;
  stellarAddress?: string | null;
  icpAddress?: string | null;
  votingPleaUnsubscribed?: string | boolean | null;
};

function normalizeOptionalBoolean(value: string | boolean | null | undefined): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return value === 'true';
}

function getLeaderboardDisplayName(user: LeaderboardUser): string {
  const hasPlaceholderName = Boolean(user.name && /^User \d+$/.test(user.name));
  if (user.name && !hasPlaceholderName) {
    return user.name;
  }

  return user.name || `User ${user.id}`;
}

// GET /api/users - Get public user summaries only.
router.get('/', async (req, res): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        onboarded: true,
        shareInGDP: true,
        createdAt: true
      },
      orderBy: { id: 'asc' },
      take: 500
    });
    res.json(users);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/leaderboard - Get GDP share leaderboard
router.get('/leaderboard', async (req, res): Promise<void> => {
  try {
    const requestedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      res.status(400).json({ error: 'Limit must be an integer between 1 and 100' });
      return;
    }
    const limit = requestedLimit;

    const users = await prisma.user.findMany({
      where: {
        isDeleted: false,
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
      name: getLeaderboardDisplayName(user),
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

// GET /api/users/salary-stats - Aggregated recommended salary stats
router.get('/salary-stats', async (req, res): Promise<void> => {
  try {
    const globalData = await prisma.global.findFirst({
      select: {
        worldGdp: true,
        salaryStatsUserCount: true,
        salaryStatsTotal: true,
        salaryStatsAverage: true,
        salaryStatsMedian: true,
        salaryStatsCalculatedAt: true
      }
    });

    if (!globalData?.worldGdp) {
      res.status(404).json({ success: false, error: 'World GDP data is not available yet' });
      return;
    }

    if (
      globalData.salaryStatsTotal === null ||
      globalData.salaryStatsAverage === null ||
      globalData.salaryStatsMedian === null ||
      globalData.salaryStatsCalculatedAt === null
    ) {
      res.status(404).json({
        success: false,
        error: 'Salary stats are not available yet. Run a full re-worth assessment first.'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        worldGdp: globalData.worldGdp,
        userCount: globalData.salaryStatsUserCount,
        totalRecommendedSalary: globalData.salaryStatsTotal,
        averageRecommendedSalary: globalData.salaryStatsAverage,
        medianRecommendedSalary: globalData.salaryStatsMedian,
        calculatedAt: globalData.salaryStatsCalculatedAt
      }
    });
  } catch (error: any) {
    console.error('Error fetching recommended salary stats:', error);
    res.status(500).json({ error: 'Failed to fetch recommended salary stats' });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id, isDeleted: false },
      select: {
        id: true,
        name: true,
        onboarded: true,
        shareInGDP: true,
        createdAt: true,
        updatedAt: true
      }
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

// Account creation must go through an authentication flow so ownership is established.
router.post('/', async (req, res): Promise<void> => {
  res.status(410).json({ error: 'Use /api/auth/register/email or a verified wallet/OAuth flow' });
});

// PUT /api/users/:id - Update user
router.put('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      email,
      name,
      ethereumAddress,
      solanaAddress,
      bitcoinAddress,
      bitcoinCashAddress,
      polkadotAddress,
      cosmosAddress,
      stellarAddress,
      icpAddress,
      votingPleaUnsubscribed
    } = req.body as UpdateUserBody;
    const authenticatedUserId = (req as any).userId;
    const parsedId = Number(id);

    // Check if user is trying to update their own account
    if (!Number.isSafeInteger(parsedId) || parsedId < 1 || parsedId !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only update your own account' });
      return;
    }

    if (name !== undefined && name !== null && (typeof name !== 'string' || name.trim().length > 200)) {
      res.status(400).json({ error: 'Name must be a string of at most 200 characters' });
      return;
    }

    const validationErrors: Record<string, string> = {
      ...validateNonEvmAddresses({
        solanaAddress,
        bitcoinAddress,
        bitcoinCashAddress,
        polkadotAddress,
        cosmosAddress,
        stellarAddress,
        icpAddress
      })
    };

    if (ethereumAddress !== null && ethereumAddress !== undefined && String(ethereumAddress).trim() && !isValidEthereumAddress(ethereumAddress)) {
      validationErrors.ethereumAddress = 'Invalid Ethereum address format.';
    }

    if (Object.keys(validationErrors).length > 0) {
      res.status(400).json({
        error: 'Invalid address format',
        details: validationErrors
      });
      return;
    }

    const normalizedVotingPleaPreference = normalizeOptionalBoolean(votingPleaUnsubscribed);

    let normalizedEthereumAddress: string | null | undefined;
    if (ethereumAddress === undefined) {
      normalizedEthereumAddress = undefined;
    } else if (ethereumAddress === null) {
      normalizedEthereumAddress = null;
    } else {
      const trimmed = String(ethereumAddress).trim();
      normalizedEthereumAddress = trimmed || null;
    }

    const user = await prisma.$transaction(async (tx) => {
      if (email) {
        const normalized = normalizeEmail(email);
        if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          throw Object.assign(new Error('Invalid email'), { code: 'INVALID_EMAIL' });
        }
        const existingEmail = await tx.userEmail.findUnique({
          where: { email: normalized }
        });
        if (existingEmail && existingEmail.userId !== authenticatedUserId) {
          throw Object.assign(new Error('Email already exists'), { code: 'P2002' });
        }
        if (!existingEmail) {
          await tx.userEmail.create({
            data: {
              userId: authenticatedUserId,
              email: normalized,
              verified: false
            }
          });
        }
      }

      await tx.user.update({
        where: { id: parsedId },
        data: {
          ...(name !== undefined && { name: name === null ? null : String(name).trim() || null }),
          ...(normalizedEthereumAddress !== undefined && { ethereumAddress: normalizedEthereumAddress }),
          ...(solanaAddress !== undefined && { solanaAddress: solanaAddress ? String(solanaAddress).trim() : null }),
          ...(bitcoinAddress !== undefined && { bitcoinAddress: bitcoinAddress ? String(bitcoinAddress).trim() : null }),
          ...(bitcoinCashAddress !== undefined && { bitcoinCashAddress: bitcoinCashAddress ? String(bitcoinCashAddress).trim() : null }),
          ...(polkadotAddress !== undefined && { polkadotAddress: polkadotAddress ? String(polkadotAddress).trim() : null }),
          ...(cosmosAddress !== undefined && { cosmosAddress: cosmosAddress ? String(cosmosAddress).trim() : null }),
          ...(stellarAddress !== undefined && { stellarAddress: stellarAddress ? String(stellarAddress).trim() : null }),
          ...(icpAddress !== undefined && { icpAddress: icpAddress ? String(icpAddress).trim() : null }),
          ...(normalizedVotingPleaPreference !== undefined && { votingPleaUnsubscribed: normalizedVotingPleaPreference })
        },
      });

      return syncPrimaryEmail(tx, authenticatedUserId);
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
    if ((error as any).code === 'INVALID_EMAIL') {
      res.status(400).json({ error: 'Invalid email address' });
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
    const parsedId = Number(id);

    // Check if user is trying to delete their own account
    if (!Number.isSafeInteger(parsedId) || parsedId < 1 || parsedId !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
      return;
    }

    const deletionTimestamp = new Date();
    // Legal requirement: User logs must be preserved for potential lawsuits, so we soft-delete instead of removing rows.
    await prisma.$transaction(async (tx) => {
      await softDeleteUser(tx, parsedId, {
        deletionTimestamp,
        removeEmails: true,
        removeSessions: true
      });
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
