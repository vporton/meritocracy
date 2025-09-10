/*
  Warnings:

  - You are about to drop the column `runnerData` on the `tasks` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "task_runner_data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runnerId" INTEGER,
    "runnerDataId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "tasks_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "task_runners" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_runnerDataId_fkey" FOREIGN KEY ("runnerDataId") REFERENCES "task_runner_data" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "id", "runnerId", "status", "updatedAt") SELECT "completedAt", "createdAt", "id", "runnerId", "status", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
