-- CreateTable
CREATE TABLE "kyc_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kyc_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_tokens_token_key" ON "kyc_tokens"("token");

-- CreateIndex
CREATE INDEX "kyc_tokens_userId_idx" ON "kyc_tokens"("userId");

-- CreateIndex
CREATE INDEX "kyc_tokens_expiresAt_idx" ON "kyc_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "kyc_tokens_used_idx" ON "kyc_tokens"("used");
