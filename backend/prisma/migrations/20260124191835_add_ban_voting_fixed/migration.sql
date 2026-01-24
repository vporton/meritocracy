-- CreateTable
CREATE TABLE "ban_votes" (
    "id" SERIAL NOT NULL,
    "voterUserId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ban_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ban_votes_targetUserId_weekStartDate_idx" ON "ban_votes"("targetUserId", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "ban_votes_voterUserId_targetUserId_weekStartDate_key" ON "ban_votes"("voterUserId", "targetUserId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "ban_votes" ADD CONSTRAINT "ban_votes_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ban_votes" ADD CONSTRAINT "ban_votes_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
