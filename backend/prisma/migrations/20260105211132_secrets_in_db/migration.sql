-- DropIndex
DROP INDEX "users_stellarAddress_idx";

-- DropIndex
DROP INDEX "users_polkadotAddress_key";

-- DropIndex
DROP INDEX "users_bitcoinAddress_key";

-- DropIndex
DROP INDEX "users_solanaAddress_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "residenceCountry" TEXT;

-- CreateTable
CREATE TABLE "system_secrets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "system_secrets_name_key" ON "system_secrets"("name");
