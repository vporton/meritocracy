/*
  Warnings:

  - A unique constraint covering the columns `[issuingState,personalNumber]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN "issuingState" TEXT;
ALTER TABLE "users" ADD COLUMN "personalNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_issuingState_personalNumber_key" ON "users"("issuingState", "personalNumber");
