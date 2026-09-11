import { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type ConnectionSnapshot = {
  emailVerified: boolean;
  bannedTill: Date | null;
  onboarded: boolean;
  isDeleted: boolean;
  kycStatus: string | null;
  kycVotingStatus: string | null;
  ethereumAddress: string | null;
  solanaAddress: string | null;
  bitcoinAddress: string | null;
  bitcoinCashAddress: string | null;
  polkadotAddress: string | null;
  cosmosAddress: string | null;
  stellarAddress: string | null;
  icpAddress: string | null;
  orcidId: string | null;
  githubHandle: string | null;
  bitbucketHandle: string | null;
  gitlabHandle: string | null;
};

export function makeUserSoftDeletePayload(deletionTimestamp: Date) {
  return {
    isDeleted: true,
    deletedAt: deletionTimestamp,
    email: null,
    ethereumAddress: null,
    solanaAddress: null,
    bitcoinAddress: null,
    bitcoinCashAddress: null,
    polkadotAddress: null,
    cosmosAddress: null,
    stellarAddress: null,
    icpAddress: null,
    orcidId: null,
    githubHandle: null,
    bitbucketHandle: null,
    gitlabHandle: null,
    onboarded: false,
    emailVerified: false,
    evaluationBlockedTill: null,
    evaluationBlockReason: null
  };
}

function hasAnyConnectedAccount(user: ConnectionSnapshot): boolean {
  return (
    user.emailVerified ||
    user.ethereumAddress !== null ||
    user.solanaAddress !== null ||
    user.bitcoinAddress !== null ||
    user.bitcoinCashAddress !== null ||
    user.polkadotAddress !== null ||
    user.cosmosAddress !== null ||
    user.stellarAddress !== null ||
    user.icpAddress !== null ||
    user.orcidId !== null ||
    user.githubHandle !== null ||
    user.bitbucketHandle !== null ||
    user.gitlabHandle !== null
  );
}

export function isImmediateDeletionCandidate(user: ConnectionSnapshot): boolean {
  return !user.isDeleted &&
    user.bannedTill === null &&
    !user.onboarded &&
    user.kycStatus === null &&
    user.kycVotingStatus === null &&
    !hasAnyConnectedAccount(user);
}

type SoftDeleteOptions = {
  deletionTimestamp?: Date;
  removeEmails?: boolean;
  removeSessions?: boolean;
};

export async function softDeleteUser(
  prisma: PrismaLike,
  userId: number,
  options: SoftDeleteOptions = {}
) {
  const deletionTimestamp = options.deletionTimestamp ?? new Date();

  if (options.removeEmails !== false) {
    await prisma.userEmail.deleteMany({
      where: { userId }
    });
  }

  if (options.removeSessions !== false) {
    await prisma.session.deleteMany({
      where: { userId }
    });
  }

  return prisma.user.update({
    where: { id: userId },
    data: makeUserSoftDeletePayload(deletionTimestamp)
  });
}
