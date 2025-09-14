/*
  Warnings:

  - You are about to drop the `task_runner_data` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `task_runners` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `runnerDataId` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `runnerId` on the `tasks` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "task_runners_name_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "task_runner_data";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "task_runners";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "runnerName" TEXT,
    "runnerClassName" TEXT,
    "runnerData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);
INSERT INTO "new_tasks" ("completedAt", "createdAt", "id", "status", "updatedAt") SELECT "completedAt", "createdAt", "id", "status", "updatedAt" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
