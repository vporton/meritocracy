-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNeverDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tasks_isDeleted_idx" ON "tasks"("isDeleted");
