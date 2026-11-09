ALTER TABLE "users"
ADD COLUMN "voluntaryPayoutPercent" DOUBLE PRECISION,
ADD COLUMN "voluntaryPayoutCap" DECIMAL,
ADD COLUMN "paymentFrozen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "livelinessForfeitedAt" TIMESTAMP(3);

CREATE INDEX "users_livelinessForfeitedAt_idx" ON "users"("livelinessForfeitedAt");
