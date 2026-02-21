-- Add user-level fields to support payment hold during ban review
-- and fast compensation scheduling after unban.
ALTER TABLE "users"
ADD COLUMN "paymentHoldStartedAt" TIMESTAMP(3),
ADD COLUMN "compensationDueAt" TIMESTAMP(3);

CREATE INDEX "users_paymentHoldStartedAt_idx" ON "users"("paymentHoldStartedAt");
CREATE INDEX "users_compensationDueAt_idx" ON "users"("compensationDueAt");
