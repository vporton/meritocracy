/*
  Warnings:

  - You are about to drop the column `description` on the `task_runner_data` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `task_runners` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `task_runners` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_task_runner_data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_task_runner_data" ("createdAt", "data", "id", "name", "updatedAt") SELECT "createdAt", "data", "id", "name", "updatedAt" FROM "task_runner_data";
DROP TABLE "task_runner_data";
ALTER TABLE "new_task_runner_data" RENAME TO "task_runner_data";
CREATE TABLE "new_task_runners" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_task_runners" ("className", "createdAt", "id", "name", "updatedAt") SELECT "className", "createdAt", "id", "name", "updatedAt" FROM "task_runners";
DROP TABLE "task_runners";
ALTER TABLE "new_task_runners" RENAME TO "task_runners";
CREATE UNIQUE INDEX "task_runners_name_key" ON "task_runners"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
