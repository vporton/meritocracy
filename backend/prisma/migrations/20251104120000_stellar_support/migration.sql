ALTER TABLE "users" ADD COLUMN "stellarAddress" TEXT;

CREATE INDEX "users_stellarAddress_idx" ON "users"("stellarAddress");
