-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kycVotingData" TEXT,
ADD COLUMN     "kycVotingRejectedAt" TIMESTAMP(3),
ADD COLUMN     "kycVotingRejectionReason" TEXT,
ADD COLUMN     "kycVotingStatus" TEXT,
ADD COLUMN     "kycVotingVerifiedAt" TIMESTAMP(3);
