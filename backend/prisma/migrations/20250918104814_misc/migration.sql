/*
  Warnings:

  - A unique constraint covering the columns `[customId]` on the table `batch_mappings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[customId]` on the table `non_batch_mappings` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `taskId` to the `batches` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taskId` to the `non_batches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "storeId" TEXT;

-- CreateTable
CREATE TABLE "global" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "worldGdp" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "gas_token_distributions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL NOT NULL,
    "amountUsd" DECIMAL NOT NULL,
    "distributionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gas_token_distributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gas_token_reserves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "totalReserve" DECIMAL NOT NULL DEFAULT 0,
    "lastDistribution" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    CONSTRAINT "batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_batches" ("createdAt", "id") SELECT "createdAt", "id" FROM "batches";
DROP TABLE "batches";
ALTER TABLE "new_batches" RENAME TO "batches";
CREATE TABLE "new_non_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    CONSTRAINT "non_batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_non_batches" ("createdAt", "id") SELECT "createdAt", "id" FROM "non_batches";
DROP TABLE "non_batches";
ALTER TABLE "new_non_batches" RENAME TO "non_batches";
CREATE TABLE "new_openai_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "taskId" INTEGER,
    "customId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "runnerClassName" TEXT NOT NULL,
    "requestInitiated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseReceived" DATETIME,
    "requestData" TEXT NOT NULL,
    "responseData" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "openai_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "openai_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_openai_logs" ("createdAt", "customId", "errorMessage", "id", "requestData", "requestInitiated", "responseData", "responseReceived", "runnerClassName", "storeId", "taskId", "updatedAt", "userId") SELECT "createdAt", "customId", "errorMessage", "id", "requestData", "requestInitiated", "responseData", "responseReceived", "runnerClassName", "storeId", "taskId", "updatedAt", "userId" FROM "openai_logs";
DROP TABLE "openai_logs";
ALTER TABLE "new_openai_logs" RENAME TO "openai_logs";
CREATE UNIQUE INDEX "openai_logs_customId_key" ON "openai_logs"("customId");
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT,
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
INSERT INTO "new_users" ("bannedTill", "bitbucketHandle", "createdAt", "email", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "lastPaymentAmount", "name", "orcidId", "shareInGDP", "updatedAt") SELECT "bannedTill", "bitbucketHandle", "createdAt", "email", "ethereumAddress", "githubHandle", "gitlabHandle", "id", "lastPaymentAmount", "name", "orcidId", "shareInGDP", "updatedAt" FROM "users";
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
CREATE UNIQUE INDEX "batch_mappings_customId_key" ON "batch_mappings"("customId");

-- CreateIndex
CREATE UNIQUE INDEX "non_batch_mappings_customId_key" ON "non_batch_mappings"("customId");
