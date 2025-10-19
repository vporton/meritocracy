-- Drop existing unique indexes for non-EVM addresses
DROP INDEX IF EXISTS "users_solanaAddress_key";
DROP INDEX IF EXISTS "users_bitcoinAddress_key";
DROP INDEX IF EXISTS "users_polkadotAddress_key";

-- Recreate the indexes as non-unique to allow duplicate addresses
CREATE INDEX IF NOT EXISTS "users_solanaAddress_key" ON "users"("solanaAddress");
CREATE INDEX IF NOT EXISTS "users_bitcoinAddress_key" ON "users"("bitcoinAddress");
CREATE INDEX IF NOT EXISTS "users_polkadotAddress_key" ON "users"("polkadotAddress");
