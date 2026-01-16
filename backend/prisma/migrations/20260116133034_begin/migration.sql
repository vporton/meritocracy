-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "ethereumAddress" TEXT,
    "solanaAddress" TEXT,
    "bitcoinAddress" TEXT,
    "polkadotAddress" TEXT,
    "cosmosAddress" TEXT,
    "stellarAddress" TEXT,
    "orcidId" TEXT,
    "githubHandle" TEXT,
    "bitbucketHandle" TEXT,
    "gitlabHandle" TEXT,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bannedTill" TIMESTAMP(3),
    "lastPaymentAmount" DECIMAL(65,30),
    "shareInGDP" DOUBLE PRECISION,
    "kycStatus" TEXT,
    "kycVerifiedAt" TIMESTAMP(3),
    "kycRejectedAt" TIMESTAMP(3),
    "kycRejectionReason" TEXT,
    "kycData" TEXT,
    "issuingState" TEXT,
    "personalNumber" TEXT,
    "residenceCountry" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_mappings" (
    "id" SERIAL NOT NULL,
    "customId" TEXT NOT NULL,
    "batchId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_batches" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" INTEGER NOT NULL,

    CONSTRAINT "non_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_batch_mappings" (
    "id" SERIAL NOT NULL,
    "customId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "nonBatchId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_batch_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "runnerClassName" TEXT NOT NULL,
    "runnerData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "storeId" TEXT,
    "lockTime" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "dependencyId" INTEGER NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "openai_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "taskId" INTEGER,
    "customId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "runnerClassName" TEXT NOT NULL,
    "requestInitiated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseReceived" TIMESTAMP(3),
    "requestData" TEXT NOT NULL,
    "responseData" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openai_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global" (
    "id" SERIAL NOT NULL,
    "worldGdp" DOUBLE PRECISION,
    "gasDistributionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gas_token_distributions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "backlogAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amountUsd" DECIMAL(65,30) NOT NULL,
    "distributionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionHash" TEXT,
    "errorMessage" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'NATIVE',
    "tokenSymbol" TEXT NOT NULL DEFAULT 'ETH',
    "tokenAddress" TEXT,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gas_token_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gas_token_reserves" (
    "id" SERIAL NOT NULL,
    "network" TEXT NOT NULL,
    "totalReserve" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastDistribution" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenType" TEXT NOT NULL DEFAULT 'NATIVE',
    "tokenSymbol" TEXT NOT NULL DEFAULT 'ETH',
    "tokenAddress" TEXT,
    "tokenDecimals" INTEGER NOT NULL DEFAULT 18,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gas_token_reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_secrets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_transactions" (
    "id" SERIAL NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "backlogAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tokenType" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executionAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastExecutionAttempt" TIMESTAMP(3),
    "executedTransactionHash" TEXT,
    "errorMessage" TEXT,
    "transactionData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_transactions_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "users_cosmosAddress_idx" ON "users"("cosmosAddress");

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
CREATE UNIQUE INDEX "gas_token_distributions_userId_network_tokenSymbol_distribu_key" ON "gas_token_distributions"("userId", "network", "tokenSymbol", "distributionDate");

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

-- CreateIndex
CREATE UNIQUE INDEX "kyc_tokens_token_key" ON "kyc_tokens"("token");

-- CreateIndex
CREATE INDEX "kyc_tokens_userId_idx" ON "kyc_tokens"("userId");

-- CreateIndex
CREATE INDEX "kyc_tokens_expiresAt_idx" ON "kyc_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "kyc_tokens_used_idx" ON "kyc_tokens"("used");

-- CreateIndex
CREATE UNIQUE INDEX "system_secrets_name_key" ON "system_secrets"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pending_transactions_transactionHash_key" ON "pending_transactions"("transactionHash");

-- CreateIndex
CREATE INDEX "pending_transactions_status_idx" ON "pending_transactions"("status");

-- CreateIndex
CREATE INDEX "pending_transactions_network_idx" ON "pending_transactions"("network");

-- CreateIndex
CREATE INDEX "pending_transactions_userId_idx" ON "pending_transactions"("userId");

-- CreateIndex
CREATE INDEX "pending_transactions_createdAt_idx" ON "pending_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "pending_transactions_status_network_idx" ON "pending_transactions"("status", "network");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_mappings" ADD CONSTRAINT "batch_mappings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_batches" ADD CONSTRAINT "non_batches_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_batch_mappings" ADD CONSTRAINT "non_batch_mappings_nonBatchId_fkey" FOREIGN KEY ("nonBatchId") REFERENCES "non_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openai_logs" ADD CONSTRAINT "openai_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "openai_logs" ADD CONSTRAINT "openai_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gas_token_distributions" ADD CONSTRAINT "gas_token_distributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_tokens" ADD CONSTRAINT "kyc_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_transactions" ADD CONSTRAINT "pending_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
