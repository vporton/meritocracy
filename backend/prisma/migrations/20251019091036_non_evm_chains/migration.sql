ALTER TABLE "users" ADD COLUMN "bitcoinAddress" TEXT;
ALTER TABLE "users" ADD COLUMN "polkadotAddress" TEXT;
ALTER TABLE "users" ADD COLUMN "solanaAddress" TEXT;

-- CreateIndex
CREATE INDEX "users_solanaAddress_key" ON "users"("solanaAddress");

-- CreateIndex
CREATE INDEX "users_bitcoinAddress_key" ON "users"("bitcoinAddress");

-- CreateIndex
CREATE INDEX "users_polkadotAddress_key" ON "users"("polkadotAddress");
