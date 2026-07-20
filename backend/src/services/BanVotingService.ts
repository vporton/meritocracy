import { prisma } from '../lib/prisma.js';
import emailService from './EmailService.js';
import { GlobalDataService } from './GlobalDataService.js';
import { getUserEmailAddresses, obfuscateEmailsInValue } from './userEmailUtils.js';

interface AssessmentWorthValue {
  key: 'overall' | 'scientist' | 'fossDev' | 'scienceMarketer';
  label: string;
  fractionOfGDP: number;
  usd: number | null;
}

interface AssessmentPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface PaginatedAssessments {
  items: any[];
  pagination: AssessmentPagination;
}

function getModelVersion(requestData: string): string | undefined {
  try {
    const request = JSON.parse(requestData) as { model?: unknown };
    return typeof request.model === 'string' ? request.model : undefined;
  } catch {
    return undefined;
  }
}

export class BanVotingService {
  /**
   * Get the start of the current week (Monday 00:00:00).
   * This ensures all votes for the same week are grouped together.
   * 
   * CRITICAL: This timing is synchronized with the gas token distribution.
   * Voting begins at the beginning of the week (returned here) and distribution
   * happens at the end (Sunday 22:00 in CronService).
   * Do not change this timing without ensuring the distribution cycle is also updated.
   */
  static getCurrentWeekStartDate(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  /**
   * Submit a ban vote against a user.
   */
  /**
   * Submit a ban or unban vote.
   */
  static async submitBanVote(voterId: number, targetId: number, message: string, type: 'BAN' | 'UNBAN' = 'BAN') {
    // 1. Check if voter is eligible (Voting KYC Approved)
    const voter = await prisma.user.findUnique({ where: { id: voterId } });
    if (voter?.kycVotingStatus !== 'APPROVED') {
      throw new Error('User is not authorized to vote (Voting KYC required)');
    }

    // 2. Check target
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new Error('Target user not found');
    }

    // Unban specific check
    const isBanned = target.bannedTill && target.bannedTill > new Date();
    if (type === 'UNBAN' && !isBanned) {
      throw new Error('Cannot vote to unban a user who is not currently banned.');
    }

    // Ban specific check? (Optional: prevent banning already banned users for less noise?)
    // if (type === 'BAN' && isBanned) { throw new Error('User is already banned.'); }

    const weekStartDate = this.getCurrentWeekStartDate();

    // Check existing votes count to determine if message is required
    const existingVotesCount = await prisma.banVote.count({
      where: {
        targetUserId: targetId,
        weekStartDate
      }
    });

    // Requirement: First vote (opening a voting) requires a message
    if (existingVotesCount === 0 && (!message || message.trim() === '')) {
      throw new Error('A message is required when starting a vote (opening the voting).');
    }

    // 3. Create Vote (or fail if duplicate due to unique constraint)
    const isFirstVote = existingVotesCount === 0;
    try {
      const vote = await prisma.banVote.create({
        data: {
          voterUserId: voterId,
          targetUserId: targetId,
          message: message || '',
          type,
          weekStartDate
        }
      });

      const targetDisplayName = target.name || `User ${target.id}`;

      if (isFirstVote) {
        emailService.sendVotingPleaEmail(targetDisplayName, type)
          .catch(error => console.error('Voting plea email failed', error));
      }

      // Start payment hold as soon as a BAN case is opened.
      if (type === 'BAN') {
        await prisma.user.updateMany({
          where: {
            id: targetId,
            paymentHoldStartedAt: null
          },
          data: {
            paymentHoldStartedAt: new Date()
          }
        });
      }

      // Check if this vote triggers a ban/unban
      await this.processVoteResult(targetId);

      return vote;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new Error('You have already voted regarding this user this week');
      }
      throw error;
    }
  }

  /**
   * Get all ban votes for a target in the current week.
   */
  static async getBanVotes(targetId: number) {
    const weekStartDate = this.getCurrentWeekStartDate();
    return await prisma.banVote.findMany({
      where: {
        targetUserId: targetId,
        weekStartDate
      },
      include: {
        voter: {
          select: {
            id: true,
            name: true,
            // Don't expose sensitive info
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Get list of evaluated users (potential targets) with their current week's vote stats
   */
  static async getEvaluatedUsersWithVoteStats() {
    const weekStartDate = this.getCurrentWeekStartDate();

    // Find all users who are "evaluated"
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { shareInGDP: { gt: 0 } },
              { onboarded: true }
            ]
          }
          // Removing { bannedTill: null } filter to allow seeing banned users for unbanning
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        shareInGDP: true,
        bannedTill: true, // Need this to know if they are banned
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true,
        orcidId: true,
        ethereumAddress: true,
        solanaAddress: true,
        bitcoinAddress: true,
        polkadotAddress: true,
        cosmosAddress: true,
        stellarAddress: true,
        icpAddress: true,
        bitcoinCashAddress: true,
        _count: false // We will aggregate manually
      }
    });

    // Aggregate votes by type for current week
    const voteCounts = await prisma.banVote.groupBy({
      by: ['targetUserId', 'type'],
      where: { weekStartDate },
      _count: { id: true }
    });

    // Create a map for quick lookup: targetId -> { BAN: count, UNBAN: count }
    const votesMap = new Map<number, { BAN: number, UNBAN: number }>();
    voteCounts.forEach(v => {
      const current = votesMap.get(v.targetUserId) || { BAN: 0, UNBAN: 0 };
      if (v.type === 'BAN') current.BAN = v._count.id;
      if (v.type === 'UNBAN') current.UNBAN = v._count.id;
      votesMap.set(v.targetUserId, current);
    });

    // Map to match the frontend expectations
    return await Promise.all(users.map(async (user) => {
      const votes = votesMap.get(user.id) || { BAN: 0, UNBAN: 0 };

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        shareInGDP: user.shareInGDP,
        bannedTill: user.bannedTill,
        isBanned: !!(user.bannedTill && user.bannedTill > new Date()),
        githubHandle: user.githubHandle,
        bitbucketHandle: user.bitbucketHandle,
        gitlabHandle: user.gitlabHandle,
        orcidId: user.orcidId,
        ethereumAddress: user.ethereumAddress,
        solanaAddress: user.solanaAddress,
        bitcoinAddress: user.bitcoinAddress,
        polkadotAddress: user.polkadotAddress,
        cosmosAddress: user.cosmosAddress,
        stellarAddress: user.stellarAddress,
        icpAddress: user.icpAddress,
        bitcoinCashAddress: user.bitcoinCashAddress,
        banVoteCount: votes.BAN,
        unbanVoteCount: votes.UNBAN,
        // Legacy support
        voteCount: votes.BAN + votes.UNBAN,
        aiResponses: await this.getUserAssessments(user.id)
      };
    }));
  }

  /**
   * Get all AI assessments for a specific user from tasks
   */
  static async getUserAssessments(userId: number) {
    const paginatedResult = await this.getUserAssessmentsPaginated(userId, { page: 1, pageSize: 50 });
    return paginatedResult.items;
  }

  /**
   * Get paginated AI assessments for a specific user from tasks
   */
  static async getUserAssessmentsPaginated(
    userId: number,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<PaginatedAssessments> {
    const pageSize = Math.max(1, options.pageSize ?? 3);
    const requestedPage = Math.max(1, options.page ?? 1);
    const worldGdp = await GlobalDataService.getWorldGdp();
    const userEmails = await getUserEmailAddresses(prisma, userId);

    // 1. Find all WorthAssessmentRunner tasks for this user
    const tasks = await prisma.task.findMany({
      where: {
        runnerClassName: 'WorthAssessmentRunner',
        runnerData: {
          contains: `"userId":${userId}`
        }
      },
      include: {
        aiResults: { include: { sources: { orderBy: { ordinal: 'asc' } } } },
        openaiLogs: {
          select: {
            customId: true,
            requestData: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    const results: any[] = [];

    for (const task of tasks) {
      if (task.aiResults.length === 0) {
        if (task.status === 'NOT_STARTED' || task.status === 'INITIATED') {
          results.push({
            text: 'Research in progress... The AI is currently searching for info or analyzing data.',
            sources: [],
            timestamp: task.createdAt,
            isPending: true
          });
        }
        continue;
      }

      for (const aiResult of task.aiResults) {
        if (aiResult.status !== 'SUCCEEDED' || !aiResult.result) {
          if (task.status === 'NOT_STARTED' || task.status === 'INITIATED') {
            results.push({
              text: 'Research in progress... Response not yet stored.',
              sources: [],
              timestamp: aiResult.createdAt,
              isPending: true
            });
          }
          continue;
        }

        try {
          const response = aiResult.result as Record<string, unknown>;
          const sources = aiResult.sources.map(source => source.url);
          const rationale = typeof response.why === 'string' ? response.why : '';
          let worthValues: AssessmentWorthValue[] = this.extractWorthValues(response, worldGdp);
          const openaiLog = task.openaiLogs.find(log => log.customId === aiResult.customId);

          results.push({
            text: obfuscateEmailsInValue(rationale || 'No rationale available in stored response.', userEmails),
            sources: obfuscateEmailsInValue([...new Set(sources)], userEmails),
            timestamp: task.completedAt || aiResult.createdAt,
            worthValues,
            modelVersion: openaiLog ? getModelVersion(openaiLog.requestData) : undefined,
            isError: task.status === 'CANCELLED'
          });
        } catch (e) {
          results.push({
            text: `Error parsing stored response for assessment.`,
            sources: [],
            timestamp: aiResult.createdAt,
            isError: true
          });
        }
      }
    }

    const sortedResults = results.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    const total = sortedResults.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const items = sortedResults.slice(offset, offset + pageSize);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    };
  }

  private static extractWorthValues(payload: any, worldGdp: number | null): AssessmentWorthValue[] {
    const worthFields: Array<{ key: AssessmentWorthValue['key']; label: string; field: string }> = [
      { key: 'overall', label: 'Overall Worth', field: 'worthAsFractionOfGDP' },
      { key: 'scientist', label: 'Scientist Worth', field: 'worthAsScientistFractionOfGDP' },
      { key: 'fossDev', label: 'FOSS Developer Worth', field: 'worthAsFossDevFractionOfGDP' },
      { key: 'scienceMarketer', label: 'Science Marketer Worth', field: 'worthAsScienceMarketerFractionOfGDP' }
    ];

    return worthFields
      .filter(({ field }) => typeof payload?.[field] === 'number')
      .map(({ key, label, field }) => {
        const fraction = payload[field] as number;
        return {
          key,
          label,
          fractionOfGDP: fraction,
          usd: worldGdp ? fraction * worldGdp : null
        };
      });
  }

  private static mergeWorthValues(
    existingValues: AssessmentWorthValue[],
    newValues: AssessmentWorthValue[]
  ): AssessmentWorthValue[] {
    const merged = new Map<AssessmentWorthValue['key'], AssessmentWorthValue>();
    for (const value of existingValues) {
      merged.set(value.key, value);
    }
    for (const value of newValues) {
      merged.set(value.key, value);
    }
    return Array.from(merged.values());
  }

  /**
   * Check if a user should be banned or unbanned based on votes.
   */
  static async processVoteResult(targetId: number) {
    const weekStartDate = this.getCurrentWeekStartDate();

    const votes = await prisma.banVote.findMany({
      where: {
        targetUserId: targetId,
        weekStartDate
      },
      select: { type: true }
    });

    const banVotesCount = votes.filter(v => v.type === 'BAN').length;
    const unbanVotesCount = votes.filter(v => v.type === 'UNBAN').length;

    const totalEligibleVoters = await prisma.user.count({
      where: {
        kycVotingStatus: 'APPROVED'
      }
    });

    // Quorum Definitions
    const QUORUM_PERCENTAGE = 0.01; // 1%
    const MIN_BAN_QUORUM = 12;
    const MIN_UNBAN_QUORUM = 16; // Higher quorum for unban

    const banQuorum = Math.max(MIN_BAN_QUORUM, Math.ceil(totalEligibleVoters * QUORUM_PERCENTAGE));
    const unbanQuorum = Math.max(MIN_UNBAN_QUORUM, Math.ceil(totalEligibleVoters * QUORUM_PERCENTAGE));

    console.log(`Processing votes for User ${targetId}. Total Voters: ${totalEligibleVoters}`);
    console.log(`BAN: ${banVotesCount}/${banQuorum}, UNBAN: ${unbanVotesCount}/${unbanQuorum}`);

    let actionTaken = false;

    // Check for BAN
    if (banVotesCount >= banQuorum) {
      const banDuration = new Date();
      banDuration.setFullYear(banDuration.getFullYear() + 1); // 1 year ban

      await prisma.user.update({
        where: { id: targetId },
        data: {
          bannedTill: banDuration,
          paymentHoldStartedAt: new Date(),
          compensationDueAt: null
        }
      });
      actionTaken = true;
    }

    // Check for UNBAN (Takes precedence if met, or if met after ban? 
    // If both happen in same transaction/week, unban should likely win or cancel out?
    // Current logic: If unban meets quorum, we unban. If ban also met quorum, unban overwrites it effectively if checks run sequentially.
    // However, if already banned, unban clears it.
    if (unbanVotesCount >= unbanQuorum) {
      await prisma.user.update({
        where: { id: targetId },
        data: {
          bannedTill: null,
          paymentHoldStartedAt: null,
          compensationDueAt: new Date()
        }
      });
      actionTaken = true;
    }

    return {
      actionTaken,
      stats: { banVotesCount, unbanVotesCount, banQuorum, unbanQuorum }
    };
  }
}
