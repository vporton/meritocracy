/*
  Warnings:

  - A unique constraint covering the columns `[solanaAddress]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bitcoinAddress]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[polkadotAddress]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN "bitcoinAddress" TEXT;
ALTER TABLE "users" ADD COLUMN "polkadotAddress" TEXT;
ALTER TABLE "users" ADD COLUMN "solanaAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_solanaAddress_key" ON "users"("solanaAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_bitcoinAddress_key" ON "users"("bitcoinAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_polkadotAddress_key" ON "users"("polkadotAddress");
