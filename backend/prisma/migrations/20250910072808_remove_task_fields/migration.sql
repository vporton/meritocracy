-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "ethereumAddress" TEXT,
    "orcidId" TEXT,
    "githubHandle" TEXT,
    "bitbucketHandle" TEXT,
    "gitlabHandle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "bannedTill" DATETIME,
    "lastPaymentAmount" DECIMAL
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
    "id" BIGINT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "batchId" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batch_mappings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "non_batches" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "non_batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "nonBatchId" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "non_batch_mappings_nonBatchId_fkey" FOREIGN KEY ("nonBatchId") REFERENCES "non_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "dependencyId" INTEGER NOT NULL,
    CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_dependencies_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "batch_mappings_customId_key" ON "batch_mappings"("customId");

-- CreateIndex
CREATE UNIQUE INDEX "non_batch_mappings_customId_key" ON "non_batch_mappings"("customId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependencyId_key" ON "task_dependencies"("taskId", "dependencyId");
