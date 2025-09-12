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
    CONSTRAINT "openai_logs_customId_key" UNIQUE ("customId"),
    CONSTRAINT "openai_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL,
    CONSTRAINT "openai_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL
);

-- CreateIndex
CREATE INDEX "openai_logs_userId_idx" ON "openai_logs"("userId");

-- CreateIndex
CREATE INDEX "openai_logs_taskId_idx" ON "openai_logs"("taskId");

-- CreateIndex
CREATE INDEX "openai_logs_customId_idx" ON "openai_logs"("customId");

-- CreateIndex
CREATE INDEX "openai_logs_runnerClassName_idx" ON "openai_logs"("runnerClassName");

-- CreateIndex
CREATE INDEX "openai_logs_requestInitiated_idx" ON "openai_logs"("requestInitiated");
