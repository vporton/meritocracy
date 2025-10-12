-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_gas_token_distributions" (
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
INSERT INTO "new_gas_token_distributions" ("amount", "amountUsd", "createdAt", "distributionDate", "errorMessage", "id", "network", "status", "transactionHash", "updatedAt", "userId") SELECT "amount", "amountUsd", "createdAt", "distributionDate", "errorMessage", "id", "network", "status", "transactionHash", "updatedAt", "userId" FROM "gas_token_distributions";
DROP TABLE "gas_token_distributions";
ALTER TABLE "new_gas_token_distributions" RENAME TO "gas_token_distributions";
CREATE INDEX "gas_token_distributions_userId_idx" ON "gas_token_distributions"("userId");
CREATE INDEX "gas_token_distributions_network_idx" ON "gas_token_distributions"("network");
CREATE INDEX "gas_token_distributions_status_idx" ON "gas_token_distributions"("status");
CREATE INDEX "gas_token_distributions_distributionDate_idx" ON "gas_token_distributions"("distributionDate");
CREATE INDEX "gas_token_distributions_network_tokenSymbol_idx" ON "gas_token_distributions"("network", "tokenSymbol");
CREATE UNIQUE INDEX "gas_token_distributions_userId_network_tokenSymbol_distributionDate_key" ON "gas_token_distributions"("userId", "network", "tokenSymbol", "distributionDate");
CREATE TABLE "new_gas_token_reserves" (
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
INSERT INTO "new_gas_token_reserves" ("createdAt", "id", "lastDistribution", "network", "totalReserve", "updatedAt") SELECT "createdAt", "id", "lastDistribution", "network", "totalReserve", "updatedAt" FROM "gas_token_reserves";
DROP TABLE "gas_token_reserves";
ALTER TABLE "new_gas_token_reserves" RENAME TO "gas_token_reserves";
CREATE UNIQUE INDEX "gas_token_reserves_network_tokenSymbol_tokenType_key" ON "gas_token_reserves"("network", "tokenSymbol", "tokenType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineIndex
DROP INDEX "users_onboarded_shareInGDP_desc_idx";
CREATE INDEX "users_onboarded_shareInGDP_idx" ON "users"("onboarded", "shareInGDP" DESC);
