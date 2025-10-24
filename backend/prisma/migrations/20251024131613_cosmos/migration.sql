-- DropIndex
DROP INDEX "users_polkadotAddress_key";

-- DropIndex
DROP INDEX "users_bitcoinAddress_key";

-- DropIndex
DROP INDEX "users_solanaAddress_key";

-- RedefineIndex
DROP INDEX "users_cosmosAddress_key";
CREATE INDEX "users_cosmosAddress_idx" ON "users"("cosmosAddress");
