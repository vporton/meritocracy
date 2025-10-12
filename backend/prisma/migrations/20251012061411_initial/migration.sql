-- CreateTable
CREATE TABLE "users" (
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
    "kycData" TEXT,
    "issuingState" TEXT,
    "personalNumber" TEXT
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    CONSTRAINT "batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "batchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batch_mappings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "non_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,
    CONSTRAINT "non_batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "non_batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "nonBatchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "non_batch_mappings_nonBatchId_fkey" FOREIGN KEY ("nonBatchId") REFERENCES "non_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "runnerClassName" TEXT NOT NULL,
    "runnerData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "storeId" TEXT,
    "lockTime" DATETIME
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "dependencyId" INTEGER NOT NULL,
    CONSTRAINT "task_dependencies_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "openai_logs" (
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
    CONSTRAINT "openai_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "openai_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "network" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "amountUsd" DECIMAL NOT NULL,
    "distributionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionHash" TEXT,
    "errorMessage" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'NATIVE',
    "tokenSymbol" TEXT NOT NULL DEFAULT 'ETH',
    "tokenAddress" TEXT,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gas_token_distributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "gas_token_reserves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "network" TEXT NOT NULL,
    "totalReserve" DECIMAL NOT NULL DEFAULT 0,
    "lastDistribution" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenType" TEXT NOT NULL DEFAULT 'NATIVE',
    "tokenSymbol" TEXT NOT NULL DEFAULT 'ETH',
    "tokenAddress" TEXT,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_ethereumAddress_key" ON "users"("ethereumAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_orcidId_key" ON "users"("orcidId");

-- CreateIndex
CREATE UNIQUE INDEX "users_githubHandle_key" ON "users"("githubHandle");

-- CreateIndex
CREATE UNIQUE INDEX "users_bitbucketHandle_key" ON "users"("bitbucketHandle");

-- CreateIndex
CREATE UNIQUE INDEX "users_gitlabHandle_key" ON "users"("gitlabHandle");

-- CreateIndex
CREATE INDEX "users_onboarded_idx" ON "users"("onboarded");

-- CreateIndex
CREATE INDEX "users_onboarded_shareInGDP_idx" ON "users"("onboarded", "shareInGDP" DESC);

-- CreateIndex
CREATE INDEX "users_shareInGDP_idx" ON "users"("shareInGDP");

-- CreateIndex
CREATE INDEX "users_kycStatus_idx" ON "users"("kycStatus");

-- CreateIndex
CREATE UNIQUE INDEX "users_issuingState_personalNumber_key" ON "users"("issuingState", "personalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "batch_mappings_customId_key" ON "batch_mappings"("customId");

-- CreateIndex
CREATE UNIQUE INDEX "non_batch_mappings_customId_key" ON "non_batch_mappings"("customId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_runnerClassName_idx" ON "tasks"("runnerClassName");

-- CreateIndex
CREATE INDEX "tasks_completedAt_idx" ON "tasks"("completedAt");

-- CreateIndex
CREATE INDEX "tasks_lockTime_idx" ON "tasks"("lockTime");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependencyId_key" ON "task_dependencies"("taskId", "dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "openai_logs_customId_key" ON "openai_logs"("customId");

-- CreateIndex
CREATE INDEX "openai_logs_userId_idx" ON "openai_logs"("userId");

-- CreateIndex
CREATE INDEX "openai_logs_taskId_idx" ON "openai_logs"("taskId");

-- CreateIndex
CREATE INDEX "openai_logs_runnerClassName_idx" ON "openai_logs"("runnerClassName");

-- CreateIndex
CREATE INDEX "openai_logs_createdAt_idx" ON "openai_logs"("createdAt");

-- CreateIndex
CREATE INDEX "openai_logs_storeId_idx" ON "openai_logs"("storeId");

-- CreateIndex
CREATE INDEX "gas_token_distributions_userId_idx" ON "gas_token_distributions"("userId");

-- CreateIndex
CREATE INDEX "gas_token_distributions_network_idx" ON "gas_token_distributions"("network");

-- CreateIndex
CREATE INDEX "gas_token_distributions_status_idx" ON "gas_token_distributions"("status");

-- CreateIndex
CREATE INDEX "gas_token_distributions_distributionDate_idx" ON "gas_token_distributions"("distributionDate");

-- CreateIndex
CREATE INDEX "gas_token_distributions_network_tokenSymbol_idx" ON "gas_token_distributions"("network", "tokenSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "gas_token_distributions_userId_network_tokenSymbol_distributionDate_key" ON "gas_token_distributions"("userId", "network", "tokenSymbol", "distributionDate");

-- CreateIndex
CREATE UNIQUE INDEX "gas_token_reserves_network_tokenSymbol_tokenType_key" ON "gas_token_reserves"("network", "tokenSymbol", "tokenType");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "email_verification_tokens_used_idx" ON "email_verification_tokens"("used");
