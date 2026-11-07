BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Run the versioned exporter queries here using explicit column allowlists.
-- Never SELECT *: schema additions must fail review rather than leak secrets.
-- The Node exporter hashes rows while this snapshot transaction remains open.
-- Representative allowlists (adapt column names to the reviewed schema revision):
-- SELECT id, name, "createdAt", status FROM users WHERE status <> 'DELETED' ORDER BY id;
-- SELECT "userId", network, asset, "normalizedAddress" FROM payout_accounts ORDER BY "userId", id;
-- SELECT "userId", status, issuer, "referenceHash", "expiresAt" FROM eligibility ORDER BY "userId";
COMMIT;
