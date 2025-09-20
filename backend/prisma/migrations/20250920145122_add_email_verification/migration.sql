-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "ethereumAddress" TEXT,
    "orcidId" TEXT,
    "githubHandle" TEXT,
    "bitbucketHandle" TEXT,
    "gitlabHandle" TEXT,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "bannedTill" DATETIME,
    "lastPaymentAmount" DECIMAL,
    "shareInGDP" REAL
);
INSERT INTO "new_users" ("bannedTill", "bitbucketHandle", "createdAt", "email", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "lastPaymentAmount", "name", "onboarded", "orcidId", "shareInGDP", "updatedAt") SELECT "bannedTill", "bitbucketHandle", "createdAt", "email", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "lastPaymentAmount", "name", "onboarded", "orcidId", "shareInGDP", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_ethereumAddress_key" ON "users"("ethereumAddress");
CREATE UNIQUE INDEX "users_orcidId_key" ON "users"("orcidId");
CREATE UNIQUE INDEX "users_githubHandle_key" ON "users"("githubHandle");
CREATE UNIQUE INDEX "users_bitbucketHandle_key" ON "users"("bitbucketHandle");
CREATE UNIQUE INDEX "users_gitlabHandle_key" ON "users"("gitlabHandle");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");
