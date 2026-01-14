-- CreateTable
CREATE TABLE "pending_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "backlogAmount" DECIMAL NOT NULL DEFAULT 0,
    "tokenType" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executionAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastExecutionAttempt" DATETIME,
    "executedTransactionHash" TEXT,
    "errorMessage" TEXT,
    "transactionData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pending_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
