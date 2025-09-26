-- CreateIndex
CREATE INDEX "users_kycStatus_idx" ON "users"("kycStatus");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "kycRejectedAt" DATETIME;
ALTER TABLE "users" ADD COLUMN "kycRejectionReason" TEXT;
ALTER TABLE "users" ADD COLUMN "kycSessionId" TEXT;
ALTER TABLE "users" ADD COLUMN "kycStatus" TEXT;
ALTER TABLE "users" ADD COLUMN "kycVerifiedAt" DATETIME;
