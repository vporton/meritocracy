ALTER TABLE "users" ADD COLUMN "cosmosAddress" TEXT;

CREATE INDEX "users_cosmosAddress_idx" ON "users"("cosmosAddress");
