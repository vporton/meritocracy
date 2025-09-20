-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "email_verification_tokens_used_idx" ON "email_verification_tokens"("used");

-- CreateIndex
CREATE INDEX "gas_token_distributions_userId_idx" ON "gas_token_distributions"("userId");

-- CreateIndex
CREATE INDEX "gas_token_distributions_status_idx" ON "gas_token_distributions"("status");

-- CreateIndex
CREATE INDEX "gas_token_distributions_distributionDate_idx" ON "gas_token_distributions"("distributionDate");

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
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_runnerClassName_idx" ON "tasks"("runnerClassName");

-- CreateIndex
CREATE INDEX "tasks_completedAt_idx" ON "tasks"("completedAt");

-- CreateIndex
CREATE INDEX "users_onboarded_idx" ON "users"("onboarded");

-- CreateIndex
CREATE INDEX "users_shareInGDP_idx" ON "users"("shareInGDP");
