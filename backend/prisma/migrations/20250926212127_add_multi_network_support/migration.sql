/*
  Warnings:

  - Added the required column `network` to the `gas_token_distributions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `network` to the `gas_token_reserves` table without a default value. This is not possible if the table is not empty.

*/
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "gas_token_distributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_gas_token_distributions" ("amount", "amountUsd", "createdAt", "distributionDate", "errorMessage", "id", "status", "transactionHash", "updatedAt", "userId") SELECT "amount", "amountUsd", "createdAt", "distributionDate", "errorMessage", "id", "status", "transactionHash", "updatedAt", "userId" FROM "gas_token_distributions";
DROP TABLE "gas_token_distributions";
ALTER TABLE "new_gas_token_distributions" RENAME TO "gas_token_distributions";
CREATE INDEX "gas_token_distributions_userId_idx" ON "gas_token_distributions"("userId");
CREATE INDEX "gas_token_distributions_network_idx" ON "gas_token_distributions"("network");
CREATE INDEX "gas_token_distributions_status_idx" ON "gas_token_distributions"("status");
CREATE INDEX "gas_token_distributions_distributionDate_idx" ON "gas_token_distributions"("distributionDate");
CREATE UNIQUE INDEX "gas_token_distributions_userId_network_distributionDate_key" ON "gas_token_distributions"("userId", "network", "distributionDate");
CREATE TABLE "new_gas_token_reserves" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "network" TEXT NOT NULL,
    "totalReserve" DECIMAL NOT NULL DEFAULT 0,
    "lastDistribution" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_gas_token_reserves" ("createdAt", "id", "lastDistribution", "totalReserve", "updatedAt") SELECT "createdAt", "id", "lastDistribution", "totalReserve", "updatedAt" FROM "gas_token_reserves";
DROP TABLE "gas_token_reserves";
ALTER TABLE "new_gas_token_reserves" RENAME TO "gas_token_reserves";
CREATE UNIQUE INDEX "gas_token_reserves_network_key" ON "gas_token_reserves"("network");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
