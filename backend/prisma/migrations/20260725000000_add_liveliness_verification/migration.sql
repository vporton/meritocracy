-- Didit Liveliness is a renewable payout eligibility check, separate from KYC.
ALTER TABLE "users"
ADD COLUMN "livelinessStatus" TEXT,
ADD COLUMN "livelinessVerifiedAt" TIMESTAMP(3),
ADD COLUMN "livelinessDueAt" TIMESTAMP(3),
ADD COLUMN "livelinessRequestedAt" TIMESTAMP(3);

CREATE INDEX "users_livelinessDueAt_idx" ON "users"("livelinessDueAt");
