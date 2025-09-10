/*
  Warnings:

  - You are about to drop the column `runnerName` on the `tasks` table. All the data in the column will be lost.
  - Made the column `runnerClassName` on table `tasks` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runnerClassName" TEXT NOT NULL,
    "runnerData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "id", "runnerClassName", "runnerData", "status", "updatedAt") SELECT "completedAt", "createdAt", "id", "runnerClassName", "runnerData", "status", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
