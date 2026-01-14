-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_global" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "worldGdp" REAL,
    "gasDistributionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_global" ("createdAt", "id", "updatedAt", "worldGdp") SELECT "createdAt", "id", "updatedAt", "worldGdp" FROM "global";
DROP TABLE "global";
ALTER TABLE "new_global" RENAME TO "global";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
