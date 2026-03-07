CREATE TABLE "user_emails" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_emails_email_key" ON "user_emails"("email");
CREATE INDEX "user_emails_userId_idx" ON "user_emails"("userId");
CREATE INDEX "user_emails_userId_verified_idx" ON "user_emails"("userId", "verified");

INSERT INTO "user_emails" ("userId", "email", "verified", "createdAt", "updatedAt")
SELECT "id", "email", "emailVerified", "createdAt", "updatedAt"
FROM "users"
WHERE "email" IS NOT NULL;

ALTER TABLE "user_emails"
ADD CONSTRAINT "user_emails_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
