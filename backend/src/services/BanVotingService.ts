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
        ethereumAddress: true,
        solanaAddress: true,
        bitcoinAddress: true,
        polkadotAddress: true,
        cosmosAddress: true,
        stellarAddress: true,
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
    return await Promise.all(users.map(async (user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      shareInGDP: user.shareInGDP,
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
      voteCount: user._count.banVotesReceived,
      aiResponses: await this.getUserAssessments(user.id)
    })));
  }

  /**
   * Get all AI assessments for a specific user from tasks
   */
  static async getUserAssessments(userId: number) {
    // 1. Find all WorthAssessmentRunner tasks for this user
    const tasks = await prisma.task.findMany({
      where: {
        runnerClassName: 'WorthAssessmentRunner',
        runnerData: {
          contains: `"userId":${userId}`
        }
      },
      include: {
        Batches: {
          include: {
            batchMappings: true
          }
        },
        NonBatches: {
          include: {
            nonbatchMappings: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const results: any[] = [];

    for (const task of tasks) {
      // Find all mappings associated with this task
      const batchMappings = task.Batches.flatMap(b => b.batchMappings);
      const nonbatchMappings = task.NonBatches.flatMap(nb => nb.nonbatchMappings);

      const allMappings = [
        ...batchMappings.map(m => ({ customId: m.customId, response: m.response, createdAt: m.createdAt })),
        ...nonbatchMappings.map(m => ({ customId: m.customId, response: m.response, createdAt: m.createdAt }))
      ];

      if (allMappings.length === 0) {
        // If no mappings yet, it might be pending
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

      for (const mapping of allMappings) {
        if (!mapping.response) {
          if (task.status === 'NOT_STARTED' || task.status === 'INITIATED') {
            results.push({
              text: 'Research in progress... Response not yet stored.',
              sources: [],
              timestamp: mapping.createdAt,
              isPending: true
            });
          }
          continue;
        }

        try {
          const response = JSON.parse(mapping.response);
          const sources: string[] = [];
          let rationale = '';

          // 1. Check root level for common fields (e.g. from Fake Mode)
          if (response.why) rationale = response.why;

          if (response.sources && Array.isArray(response.sources)) {
            sources.push(...response.sources);
          }

          // 2. Explore nested structures (OpenAI Output structure)
          // The response structure typically has an "output" array
          const outputArr = response.output || (response.choices ? [response] : []);

          outputArr.forEach((item: any) => {
            // Extract sources from web_search_call
            if (item.type === 'web_search_call') {
              if (item.action?.url) sources.push(item.action.url);
              if (item.action?.sources) {
                item.action.sources.forEach((s: any) => {
                  if (s.url) sources.push(s.url);
                });
              }
            }

            // Extract rationale and citations from message content
            if (item.content) {
              item.content.forEach((c: any) => {
                // Support both 'text' and 'output_text' (new GPT-5 mini format)
                if ((c.type === 'text' || c.type === 'output_text') && c.text) {
                  // Extract citations from annotations if present
                  if (c.annotations && Array.isArray(c.annotations)) {
                    c.annotations.forEach((ann: any) => {
                      if (ann.type === 'url_citation' && ann.url) {
                        sources.push(ann.url);
                      }
                    });
                  }

                  // Try to parse the text as JSON to find hidden 'why'
                  try {
                    const json = JSON.parse(c.text);
                    if (json.why) rationale = json.why;
                    if (json.sources && Array.isArray(json.sources)) {
                      sources.push(...json.sources);
                    }
                  } catch (e) {
                    // Not JSON, or doesn't have 'why' - use as raw text if we don't have rationale yet
                    if (!rationale) rationale = c.text;
                  }
                }
              });
            } else if (item.choices?.[0]?.message?.content) {
              // Standard chat completion structure
              const content = item.choices[0].message.content;
              try {
                const json = JSON.parse(content);
                if (json.why) rationale = json.why;
                if (json.sources && Array.isArray(json.sources)) sources.push(...json.sources);
              } catch (e) {
                if (!rationale) rationale = content;
              }
            }
          });

          results.push({
            text: rationale || 'No rationale available in stored response.',
            sources: [...new Set(sources)],
            timestamp: task.completedAt || mapping.createdAt,
            isError: task.status === 'CANCELLED'
          });
        } catch (e) {
          results.push({
            text: `Error parsing stored response for assessment.`,
            sources: [],
            timestamp: mapping.createdAt,
            isError: true
          });
        }
      }
    }

    return results;
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
