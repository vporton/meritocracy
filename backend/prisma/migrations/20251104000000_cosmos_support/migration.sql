ALTER TABLE "users" ADD COLUMN "cosmosAddress" TEXT;

-- CreateIndex
CREATE INDEX "users_cosmosAddress_key" ON "users"("cosmosAddress");
