import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
  static async submitBanVote(voterId: number, targetId: number, message: string) {
    // 1. Check if voter is eligible (Voting KYC Approved)
    const voter = await prisma.user.findUnique({ where: { id: voterId } });
    if (voter?.kycVotingStatus !== 'APPROVED') {
      throw new Error('User is not authorized to vote (Voting KYC required)');
    }

    // 2. Check if target is an evaluated user (Has shareInGDP presumably, or just exists)
    // The requirement says "evaluated users". We'll assume any user with shareInGDP > 0 is evaluated.
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new Error('Target user not found');
    }

    // We can enforce "evaluated user" check strictly if needed:
    // if (!target.shareInGDP) { throw new Error("Target is not an evaluated user"); }

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
      throw new Error('A message is required when starting a ban vote (opening the voting).');
    }

    // 3. Create Vote (or fail if duplicate due to unique constraint)
    try {
      const vote = await prisma.banVote.create({
        data: {
          voterUserId: voterId,
          targetUserId: targetId,
          message: message || '', // Store empty string if message is optional and missing
          weekStartDate
        }
      });

      // Check if this vote triggers a ban
      await this.checkAndBanUser(targetId);

      return vote;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new Error('You have already voted against this user this week');
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

    // Find all users who are "evaluated" (e.g. have a share in GDP or are onboarded)
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { shareInGDP: { gt: 0 } },
              { onboarded: true }
            ]
          },
          { bannedTill: null }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        shareInGDP: true,
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true,
        orcidId: true,
        _count: {
          select: {
            banVotesReceived: {
              where: { weekStartDate }
            }
          }
        }
      }
    });

    // Map to match the frontend expectations and include AI responses from logs
    return await Promise.all(users.map(async (user) => {
      // 1. Find the latest MedianRunner task for this user to get source task IDs
      const medianTask = await prisma.task.findFirst({
        where: {
          runnerClassName: 'MedianRunner',
          status: 'COMPLETED',
          runnerData: {
            contains: `"userId":${user.id}`
          }
        },
        orderBy: { completedAt: 'desc' }
      });

      let aiResponses: any[] = [];

      if (medianTask && medianTask.runnerData) {
        try {
          const medianData = JSON.parse(medianTask.runnerData);
          const sourceTaskIds = medianData.sourceTaskIds || [];

          if (sourceTaskIds.length > 0) {
            // 2. Fetch logs for those source tasks
            const logs = await prisma.openAILog.findMany({
              where: {
                taskId: { in: sourceTaskIds },
                responseReceived: { not: null }
              },
              orderBy: { responseReceived: 'desc' }
            });

            aiResponses = logs.map(log => {
              try {
                const responseData = JSON.parse(log.responseData || '{}');
                const sources: string[] = [];
                let rationale = 'No rationale provided';

                // Extract data from OpenAI's flexible-batches "output" array
                responseData.output?.forEach((item: any) => {
                  // 1. Extract sources from web_search_call (as requested)
                  if (item.web_search_call?.action?.sources) {
                    item.web_search_call.action.sources.forEach((s: any) => {
                      if (s.url) sources.push(s.url);
                    });
                  }

                  // 2. Extract rationale and additional sources from JSON content
                  if (item.content) {
                    item.content.forEach((c: any) => {
                      if (c.type === 'text' && c.text) {
                        try {
                          const json = JSON.parse(c.text);
                          if (json.why) rationale = json.why;
                          if (json.sources && Array.isArray(json.sources)) {
                            sources.push(...json.sources);
                          }
                        } catch (e) {
                          // Not JSON or doesn't have the fields
                        }
                      }
                    });
                  }
                });

                return {
                  text: rationale,
                  sources: [...new Set(sources)]
                };
              } catch (e) {
                return null;
              }
            }).filter(res => res !== null);
          }
        } catch (e) {
          console.error(`Error parsing median task for user ${user.id}:`, e);
        }
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        shareInGDP: user.shareInGDP,
        githubHandle: user.githubHandle,
        bitbucketHandle: user.bitbucketHandle,
        gitlabHandle: user.gitlabHandle,
        orcidId: user.orcidId,
        voteCount: user._count.banVotesReceived,
        aiResponses
      };
    }));
  }

  /**
   * Check if a user should be banned based on votes.
   * "Exact formulas for enough votes and quorum".
   * 
   * Proposed Formula:
   * 1. Total Eligible Voters = Count of users with kycVotingStatus = 'APPROVED'.
   * 2. Quorum = 10% of Total Eligible Voters (Min 3).
   * 3. Condition: If Count(BanVotes) >= Quorum -> BAN.
   */
  static async checkAndBanUser(targetId: number) {
    const weekStartDate = this.getCurrentWeekStartDate();

    const votesCount = await prisma.banVote.count({
      where: {
        targetUserId: targetId,
        weekStartDate
      }
    });

    const totalEligibleVoters = await prisma.user.count({
      where: {
        kycVotingStatus: 'APPROVED'
      }
    });

    // Formula definition
    // For now, let's use a simple relative quorum
    const QUORUM_PERCENTAGE = 0.10; // 10%
    const MIN_QUORUM = 12;

    const quorum = Math.max(MIN_QUORUM, Math.ceil(totalEligibleVoters * QUORUM_PERCENTAGE));

    console.log(`Checking ban for User ${targetId}. Votes: ${votesCount}, Quorum Needed: ${quorum}`);

    if (votesCount >= quorum) {
      // Ban the user
      // Requirement doesn't specify duration. Setting to 1 year for now.
      const banDuration = new Date();
      banDuration.setFullYear(banDuration.getFullYear() + 1);

      await prisma.user.update({
        where: { id: targetId },
        data: {
          bannedTill: banDuration
        }
      });
      return { banned: true, votes: votesCount, quorum };
    }

    return { banned: false, votes: votesCount, quorum };
  }
}
