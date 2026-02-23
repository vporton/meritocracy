import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateNonEvmAddresses } from '../utils/addressValidation.js';
import { makeUserSoftDeletePayload } from '../services/userDeletionUtils.js';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// Remove duplicate auth middleware - now imported from shared module

type KycNameData = {
  firstName?: string;
  lastName?: string;
  first_name?: string;
  last_name?: string;
};

type LeaderboardUser = {
  id: number;
  name: string | null;
  kycVotingData: string | null;
  kycData: string | null;
};

function calculateMedian(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

type SalaryStatsPayload = {
  worldGdp: number;
  userCount: number;
  totalRecommendedSalary: number;
  averageRecommendedSalary: number;
  medianRecommendedSalary: number;
};

type SalaryStatsCacheEntry = {
  timestamp: number;
  data: SalaryStatsPayload;
};
const SALARY_STATS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let salaryStatsCache: SalaryStatsCacheEntry | null = null;

function extractKycName(kycData: string | null): string | null {
  if (!kycData) return null;
  try {
    const parsed = JSON.parse(kycData) as KycNameData;
    const firstName = parsed.firstName ?? parsed.first_name;
    const lastName = parsed.lastName ?? parsed.last_name;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    return name || null;
  } catch (error) {
    console.warn('Failed to parse KYC data for display name:', error);
    return null;
  }
}

function getLeaderboardDisplayName(user: LeaderboardUser): string {
  const hasPlaceholderName = Boolean(user.name && /^User \d+$/.test(user.name));
  if (user.name && !hasPlaceholderName) {
    return user.name;
  }

  const kycVotingName = extractKycName(user.kycVotingData);
  if (kycVotingName) return kycVotingName;

  const kycName = extractKycName(user.kycData);
  if (kycName) return kycName;

  return user.name || `User ${user.id}`;
}

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
        kycVotingData: true,
        kycData: true,
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
    const now = Date.now();
    if (salaryStatsCache && now - salaryStatsCache.timestamp <= SALARY_STATS_CACHE_TTL_MS) {
      res.json({
        success: true,
        data: salaryStatsCache.data
      });
      return;
    }

    const globalData = await prisma.global.findFirst();
    if (!globalData?.worldGdp) {
      res.status(404).json({ success: false, error: 'World GDP data is not available yet' });
      return;
    }

    const shareRows = await prisma.user.findMany({
      where: {
        shareInGDP: {
          not: null
        }
      },
      select: {
        shareInGDP: true
      }
    });

    const shareValues = shareRows.map(user => Number(user.shareInGDP ?? 0));
    const totalShare = shareValues.reduce((sum, value) => sum + value, 0);
    const averageShare = shareValues.length ? totalShare / shareValues.length : 0;
    const medianShare = calculateMedian(shareValues);

    const multiplier = globalData.worldGdp;
    const toCurrency = (shareFraction: number) => shareFraction * multiplier;

    const payload = {
      worldGdp: multiplier,
      userCount: shareValues.length,
      totalRecommendedSalary: toCurrency(totalShare),
      averageRecommendedSalary: toCurrency(averageShare),
      medianRecommendedSalary: toCurrency(medianShare)
    };

    salaryStatsCache = {
      timestamp: now,
      data: payload
    };

    res.json({
      success: true,
      data: payload
    });
  } catch (error: any) {
    console.error('Error fetching recommended salary stats:', error);
    res.status(500).json({ error: 'Failed to fetch recommended salary stats' });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id as string) },
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
    const {
      email,
      name,
      solanaAddress,
      bitcoinAddress,
      bitcoinCashAddress,
      polkadotAddress,
      cosmosAddress,
      stellarAddress,
      icpAddress,
      votingPleaUnsubscribed
    }: {
      email: string,
      name: string,
      solanaAddress: string,
      bitcoinAddress: string,
      bitcoinCashAddress: string,
      polkadotAddress: string,
      cosmosAddress: string,
      stellarAddress: string,
      icpAddress: string,
      votingPleaUnsubscribed: string
    } = req.body;
    const authenticatedUserId = (req as any).userId;

    // Check if user is trying to update their own account
    if (parseInt(id as string) !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only update your own account' });
      return;
    }

    const validationErrors = validateNonEvmAddresses({
      solanaAddress,
      bitcoinAddress,
      bitcoinCashAddress,
      polkadotAddress,
      cosmosAddress,
      stellarAddress,
      icpAddress
    });

    if (Object.keys(validationErrors).length > 0) {
      res.status(400).json({
        error: 'Invalid address format',
        details: validationErrors
      });
      return;
    }

    let normalizedVotingPleaPreference: string | boolean = votingPleaUnsubscribed; // TODO@P3: Use one type, not two.
    if (typeof normalizedVotingPleaPreference === 'string') {
      normalizedVotingPleaPreference = normalizedVotingPleaPreference === 'true';
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id as string) },
      data: {
        ...(email && { email }),
        ...(name !== undefined && { name }),
        ...(solanaAddress !== undefined && { solanaAddress: solanaAddress?.trim() ? solanaAddress.trim() : null }),
        ...(bitcoinAddress !== undefined && { bitcoinAddress: bitcoinAddress?.trim() ? bitcoinAddress.trim() : null }),
        ...(bitcoinCashAddress !== undefined && { bitcoinCashAddress: bitcoinCashAddress?.trim() ? bitcoinCashAddress.trim() : null }),
        ...(polkadotAddress !== undefined && { polkadotAddress: polkadotAddress?.trim() ? polkadotAddress.trim() : null }),
        ...(cosmosAddress !== undefined && { cosmosAddress: cosmosAddress?.trim() ? cosmosAddress.trim() : null }),
        ...(stellarAddress !== undefined && { stellarAddress: stellarAddress?.trim() ? stellarAddress.trim() : null }),
        ...(icpAddress !== undefined && { icpAddress: icpAddress?.trim() ? icpAddress.trim() : null }),
        ...(normalizedVotingPleaPreference !== undefined && { votingPleaUnsubscribed: normalizedVotingPleaPreference })
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
    if (parseInt(id as string) !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
      return;
    }

    const deletionTimestamp = new Date();
    // Legal requirement: User logs must be preserved for potential lawsuits, so we soft-delete instead of removing rows.
    await prisma.user.update({
      where: { id: parseInt(id as string) },
      data: makeUserSoftDeletePayload(deletionTimestamp)
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
