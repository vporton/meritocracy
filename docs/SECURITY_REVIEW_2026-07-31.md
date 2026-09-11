# Security review — 2026-07-31

## Scope and result

This review covered the Express routes and middleware, React authentication
flows, Prisma credential storage, KYC webhook processing, privileged jobs,
payment-distribution entry points, RPC clients, logging, deployment settings,
and direct/transitive npm dependencies.

The local changes close the exploitable authentication and authorization defects
found during the review. They do not make the system ready to custody production
funds: the remaining key-custody and payment-workflow risks below require an
architectural change and independent review.

## Corrected findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Public endpoints could trigger distributions, refresh global state, run cleanup, and create country/region signing accounts | State-changing operational routes now require fail-closed admin or cron authorization with timing-safe comparison and throttling |
| Critical | GitHub, GitLab, Bitbucket, and ORCID handles were accepted as login credentials | Direct handle login is disabled; backend OAuth with signed state and nonce-cookie binding is required |
| Critical | OAuth placed bearer sessions in state/result URLs and exposed reusable lookup results | Provider codes terminate at the API and the popup result is posted only to the exact configured frontend origin; secrets are not logged or put in URLs |
| Critical | Email registration issued a seven-day session before email ownership was proven | Registration is unauthenticated; atomic one-time verification creates the session |
| High | Ethereum signatures were replayable indefinitely | Login requires a stored, single-use, five-minute challenge bound to the normalized address and exact message |
| High | Linking an already-owned provider identity could merge users, sessions, KYC status, votes, and financial history | Cross-account identity linking now returns a conflict and never transfers account data |
| High | Bearer sessions and email/KYC link credentials were stored in plaintext | New credentials are stored only as SHA-256 digests; the migration invalidates legacy plaintext rows |
| High | KYC callbacks could create or bind the wrong account and logged sensitive payload details | Callbacks require a valid HMAC, fresh timestamp, installation/workflow/session binding, an existing non-deleted user, and redacted logs |
| High | Logs, histories, cleanup statistics, and full user records exposed more data than their callers needed | Global views are admin-only, self views enforce ownership, outputs are narrowed, and query sizes are bounded |
| High | The legacy `bitcoin-core` dependency pulled an unmaintained `request` chain with critical advisories | Replaced it with a small bounded JSON-RPC client with URL validation, timeout, response limit, and explicit authentication headers |
| Medium | Admin password remained in browser local storage and external source links accepted arbitrary schemes | Admin password is memory-only and links allow only HTTP(S) URLs |
| Medium | Authentication endpoints had no request throttling and request bodies were effectively broad | Added fixed-window limits and explicit JSON/form body limits |

Unused Passport, JWT, session, bcrypt, `crypto`, and vulnerable OAuth helper
packages were removed. Nodemailer was upgraded to its patched major release.

## Open risks and required follow-up

1. **Critical — signing-key custody.** `SystemSecretService` stores blockchain
   private keys and mnemonics as plaintext database values and copies them into
   process environment. Move signing to an HSM/KMS, threshold signer, or narrowly
   controlled signing service; use multisig and per-network withdrawal limits.

2. **High — payment atomicity.** Database commits and external blockchain sends
   cannot be atomic. Formally specify idempotency keys, state transitions,
   confirmation/reorg handling, reconciliation, and manual recovery before real
   funds are enabled.

3. **High — frontend bearer storage and CSP.** Sessions remain in `localStorage`
   and the application CSP permits inline script. A frontend XSS can steal a
   session. Move sessions to Secure, HttpOnly, SameSite cookies with CSRF
   protection and remove `unsafe-inline` using nonces or hashes.

4. **High — OAuth subject stability.** Provider handles/usernames are mutable and
   serve as account keys. Add immutable provider subject IDs in dedicated identity
   rows, retain handles only as display metadata, and migrate existing links with
   provider re-verification.

5. **High — dependency advisories.** The remaining production advisories are
   primarily in wallet/chain SDK trees (Axios via Reown Bitcoin, `bigint-buffer`
   via Solana, `ws` via Viem, and related packages) plus the current React Router.
   No non-breaking complete fix was available. Disable unused wallet adapters or
   upgrade/replace the affected stacks after compatibility testing; do not use
   `npm audit fix --force` without reviewing its proposed downgrades.

6. **High — KYC event ordering and replay.** HMAC and timestamp validation stop
   forged callbacks, but durable provider event IDs and monotonic state handling
   are still needed to make duplicate or out-of-order callbacks idempotent.

7. **Medium — sensitive data lifecycle.** KYC document data and personal numbers
   are stored in application tables. Define field-level encryption, retention and
   deletion schedules, access logging, backups policy, and legal basis before
   production collection.

8. **Medium — shared privileged credentials.** Admin and cron authorization use
   static shared secrets. Replace admin access with named roles, MFA, short-lived
   credentials, and immutable audit events. Rotate both secrets after deployment.

9. **Medium — distributed throttling.** Authentication throttles are per process.
   Multi-instance deployments need a shared edge or datastore-backed limiter.

10. **Medium — identity and payout address coupling.** Ethereum address is both an
    authentication identity and an editable payout destination. Split verified
    identities from payout instructions and require proof/step-up confirmation for
    destination changes.

11. **Medium — public correlation.** Ban-voting views intentionally correlate
    social identities and multiple wallet addresses. Confirm that this disclosure
    is required and consented; otherwise return connection evidence without raw
    identifiers.

12. **Medium — external call resilience.** OAuth and KYC calls need consistent
    deadlines, circuit breakers, bounded response parsing, and correlation IDs.
    RPC URLs carrying credentials should require HTTPS except for explicitly
    approved loopback/private development endpoints.

## Verification performed

- `npm run build` — backend TypeScript and production frontend build passed.
- `npm test` — 6 focused security tests and 4 database-backed distribution tests passed.
- Prisma migration deploy — passed against the local test database.
- `git diff --check` — passed.
- `npm run lint --workspace frontend` — could not run because the repository uses
  ESLint 10 without the required flat `eslint.config.*`; migrate the existing
  lint configuration before treating lint as a CI security control.
- Live `npm audit --omit=dev` — 0 critical, 17 high, and 7 moderate
  production advisories remain; they are concentrated in the wallet/chain and
  routing dependency trees described above.

Before deployment, take a database backup, expect all existing sessions and
outstanding email/KYC links to be invalidated, set a strong
`OAUTH_STATE_SECRET`, and rotate privileged credentials.
