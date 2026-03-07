import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isValidEthereumAddress, validateNonEvmAddresses } from '../utils/addressValidation.js';
import { makeUserSoftDeletePayload } from '../services/userDeletionUtils.js';
import { prisma } from '../lib/prisma.js';
import { normalizeEmail, removeAllUserEmails, syncPrimaryEmail } from '../services/userEmailUtils.js';

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
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id as string) },
      select: {
        id: true,
        name: true,
        ethereumAddress: true,
        solanaAddress: true,
        bitcoinAddress: true,
        bitcoinCashAddress: true,
        polkadotAddress: true,
        cosmosAddress: true,
        stellarAddress: true,
        icpAddress: true,
        orcidId: true,
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true,
        onboarded: true,
        shareInGDP: true,
        kycStatus: true,
        kycVerifiedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true,
        createdAt: true,
        updatedAt: true,
        votingPleaUnsubscribed: true,
        kycVotingStatus: true,
        kycVotingVerifiedAt: true,
        kycVotingRejectedAt: true,
        kycVotingRejectionReason: true
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
        email: normalizeEmail(email),
        name: name || null,
        emails: {
          create: {
            email: normalizeEmail(email),
            verified: false
          }
        }
      },
      include: {
        emails: {
          orderBy: [
            { verified: 'desc' },
            { createdAt: 'asc' }
          ]
        }
      }
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
      ethereumAddress,
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
      ethereumAddress: string,
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

    if (ethereumAddress && ethereumAddress.trim() && !isValidEthereumAddress(ethereumAddress)) {
      validationErrors.ethereumAddress = 'Invalid Ethereum address format.';
    }

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

    const user = await prisma.$transaction(async (tx) => {
      if (email) {
        const normalized = normalizeEmail(email);
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
        where: { id: parseInt(id as string) },
        data: {
          ...(name !== undefined && { name }),
          ...(ethereumAddress !== undefined && { ethereumAddress: ethereumAddress?.trim() ? ethereumAddress.trim() : null }),
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
    await prisma.$transaction(async (tx) => {
      await removeAllUserEmails(tx, parseInt(id as string));
      await tx.user.update({
        where: { id: parseInt(id as string) },
        data: makeUserSoftDeletePayload(deletionTimestamp)
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
