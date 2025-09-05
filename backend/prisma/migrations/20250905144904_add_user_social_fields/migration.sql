-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "ethereumAddress" TEXT,
    "orcidId" TEXT,
    "githubHandle" TEXT,
    "bitbucketHandle" TEXT,
    "gitlabHandle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_ethereumAddress_key" ON "users"("ethereumAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_orcidId_key" ON "users"("orcidId");

-- CreateIndex
CREATE UNIQUE INDEX "users_githubHandle_key" ON "users"("githubHandle");

-- CreateIndex
CREATE UNIQUE INDEX "users_bitbucketHandle_key" ON "users"("bitbucketHandle");

-- CreateIndex
CREATE UNIQUE INDEX "users_gitlabHandle_key" ON "users"("gitlabHandle");
