CREATE TABLE "ethereum_auth_challenges" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ethereum_auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ethereum_auth_challenges_address_idx" ON "ethereum_auth_challenges"("address");
CREATE INDEX "ethereum_auth_challenges_expiresAt_idx" ON "ethereum_auth_challenges"("expiresAt");

-- Existing rows contain bearer credentials in plaintext. Invalidate them so all
-- newly issued sessions use one-way token digests.
DELETE FROM "sessions";

-- KYC email-link tokens also act as login credentials and are now stored only
-- as digests. Previously issued links are intentionally invalidated.
DELETE FROM "kyc_tokens";

-- Verification tokens are likewise stored as one-way digests after this change.
DELETE FROM "email_verification_tokens";
