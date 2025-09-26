/*
  Warnings:

  - You are about to drop the column `kycSessionId` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "lockTime" DATETIME;

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
    "shareInGDP" REAL,
    "kycStatus" TEXT,
    "kycVerifiedAt" DATETIME,
    "kycRejectedAt" DATETIME,
    "kycRejectionReason" TEXT,
    "kycData" TEXT
);
INSERT INTO "new_users" ("bannedTill", "bitbucketHandle", "createdAt", "email", "emailVerified", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "kycRejectedAt", "kycRejectionReason", "kycStatus", "kycVerifiedAt", "lastPaymentAmount", "name", "onboarded", "orcidId", "shareInGDP", "updatedAt") SELECT "bannedTill", "bitbucketHandle", "createdAt", "email", "emailVerified", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "kycRejectedAt", "kycRejectionReason", "kycStatus", "kycVerifiedAt", "lastPaymentAmount", "name", "onboarded", "orcidId", "shareInGDP", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_ethereumAddress_key" ON "users"("ethereumAddress");
CREATE UNIQUE INDEX "users_orcidId_key" ON "users"("orcidId");
CREATE UNIQUE INDEX "users_githubHandle_key" ON "users"("githubHandle");
CREATE UNIQUE INDEX "users_bitbucketHandle_key" ON "users"("bitbucketHandle");
CREATE UNIQUE INDEX "users_gitlabHandle_key" ON "users"("gitlabHandle");
CREATE INDEX "users_onboarded_idx" ON "users"("onboarded");
CREATE INDEX "users_shareInGDP_idx" ON "users"("shareInGDP");
CREATE INDEX "users_kycStatus_idx" ON "users"("kycStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "tasks_lockTime_idx" ON "tasks"("lockTime");
