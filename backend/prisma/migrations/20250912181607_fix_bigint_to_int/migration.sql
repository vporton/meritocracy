-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Redefine batches table
CREATE TABLE "new_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_batches" ("id", "createdAt") SELECT "id", "createdAt" FROM "batches";
DROP TABLE "batches";
ALTER TABLE "new_batches" RENAME TO "batches";

-- Redefine batch_mappings table
CREATE TABLE "new_batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "batchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batch_mappings_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_batch_mappings" ("id", "customId", "batchId", "createdAt") SELECT "id", "customId", "batchId", "createdAt" FROM "batch_mappings";
DROP TABLE "batch_mappings";
ALTER TABLE "new_batch_mappings" RENAME TO "batch_mappings";

-- Redefine non_batches table
CREATE TABLE "new_non_batches" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_non_batches" ("id", "createdAt") SELECT "id", "createdAt" FROM "non_batches";
DROP TABLE "non_batches";
ALTER TABLE "new_non_batches" RENAME TO "non_batches";

-- Redefine non_batch_mappings table
CREATE TABLE "new_non_batch_mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "nonBatchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "non_batch_mappings_nonBatchId_fkey" FOREIGN KEY ("nonBatchId") REFERENCES "non_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_non_batch_mappings" ("id", "customId", "response", "nonBatchId", "createdAt") SELECT "id", "customId", "response", "nonBatchId", "createdAt" FROM "non_batch_mappings";
DROP TABLE "non_batch_mappings";
ALTER TABLE "new_non_batch_mappings" RENAME TO "non_batch_mappings";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
