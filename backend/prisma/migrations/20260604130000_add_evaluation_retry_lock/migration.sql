ALTER TABLE "users"
ADD COLUMN "evaluationBlockedTill" TIMESTAMP(3),
ADD COLUMN "evaluationBlockReason" TEXT;

CREATE INDEX "users_evaluationBlockedTill_idx" ON "users"("evaluationBlockedTill");
