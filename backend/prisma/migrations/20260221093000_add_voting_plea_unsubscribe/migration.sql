-- Add flag to let users unsubscribe from voting plea emails
ALTER TABLE "users"
ADD COLUMN "votingPleaUnsubscribed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_votingPleaUnsubscribed_idx" ON "users"("votingPleaUnsubscribed");
