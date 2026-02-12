ALTER TABLE "users" ADD COLUMN "icpAddress" TEXT;

CREATE INDEX "users_icpAddress_idx" ON "users"("icpAddress");
