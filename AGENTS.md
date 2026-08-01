# AGENTS.md

## Scope

This repository is being migrated from the legacy Node.js/TypeScript, Prisma, and PostgreSQL application to Motoko canisters on the Internet Computer. Keep the legacy application runnable until feature parity, deterministic data reconciliation, and the production cutover criteria in `PLANS.md` are satisfied.

`PLANS.md` is the execution authority for migration order and approval gates. Do not implement work beyond an unapproved gate.

## Repository commands

Run commands from the repository root unless a command explicitly changes directory.

```sh
nvm use stable
npm install
npm run build
npm run test:security --workspace backend
npm test
npm run lint --workspace frontend
git diff --check
```

The database-backed integration tests delete financial rows. They may run only after a guard proves `DATABASE_URL` names an isolated disposable test database and is not production or staging. Until that guard exists, run only the security suite or an explicitly provisioned disposable database.

The ICP toolchain commands below become required after the corresponding manifests are added and pinned:

```sh
mops check
mops test
mops format --check
mops build
mops check-stable
icp network start -d
icp deploy -e local
```

Use PocketIC/local-ledger integration tests for canister state machines. Use only documented test networks for chain integrations. Never point automated tests at a mainnet signer, production canister, production database, or funded account.

## Existing repository rules

- Use `nvm use stable` to select Node.js.
- Never run `npm install` in `backend/` or `frontend/`. This is an npm-workspaces repository with one root `node_modules/`.
- After a TODO/FIXME is fully accomplished, remove its corresponding item from `TODO.md` and remove the adjacent empty line. Do not remove the ICP migration TODO while the migration remains incomplete.
- Preserve unrelated user changes in a dirty worktree.

## Engineering rules

- Make milestones small, coherent, reviewable, and independently reversible. Follow the milestone order and rollback point in `PLANS.md`.
- Before each implementation milestone, restate its invariants and acceptance criteria. After it, add/update tests, run relevant formatting/type/build/test checks, review the diff for security/regressions, and update `PLANS.md` plus `docs/icp/PARITY_CHECKLIST.md`.
- Pin Motoko, Mops, ICP CLI/DFX, canister recipes, Candid interfaces, third-party canister IDs, npm packages, and Chain Fusion dependencies. Commit lockfiles and reproducible-build metadata.
- Treat Candid interfaces and Motoko stable type signatures as compatibility contracts. Check Candid subtyping and stable compatibility before every canister upgrade.
- Use `persistent actor`/enhanced orthogonal persistence for new Motoko actors. Avoid large `preupgrade` copies. Re-register timers after upgrade and persist durable schedules, leases, and cursors rather than relying on timer IDs.
- Bound every ingress/cross-canister payload, collection scan, query result, text/blob field, timer batch, retry count, and external HTTP response. Pagination must use stable opaque cursors, not unbounded scans or large offsets.
- Every state-changing public method must authenticate the caller and authorize the exact resource/action in the method body. Never trust caller-supplied principals, user IDs, roles, or canister IDs without binding them to `caller` or an allowlist.
- Model multi-canister and external-chain work as explicit, durable sagas. State before and after every `await` is separately committed; journal before calling out, make callbacks idempotent, and tolerate traps, timeouts, duplicate delivery, reordering, and upgrade interruption.
- Do not use floating point for money, token amounts, fees, liabilities, reserves, GDP-share payout arithmetic, or reconciliation. Store integer base units with explicit asset decimals; define deterministic rounding and remainder allocation.
- Never hard-delete financial, authorization, migration, evaluation, or audit history. Use tombstones/redaction and append-only events. PII deletion uses approved redaction or cryptographic erasure without destroying required accounting history.
- Never log or commit private keys, mnemonics, OAuth/API credentials, KYC documents, bearer credentials, raw verification tokens, or unredacted webhook payloads.
- No legacy blockchain secret may be copied into ordinary canister state. Record only approved fingerprints/metadata; rotate or retire the secret under the wallet runbook.
- External service responses are untrusted. Use HTTPS, bounded responses, deterministic transforms where consensus is required, provider event IDs, freshness checks, signatures/HMACs, monotonic state rules, and idempotency keys.
- A canister controller list is not a multisig: any listed controller can upgrade. Production controller authority must follow `docs/icp/WALLET_SECURITY.md` and be verified on-chain after deployment.
- Do not transfer real assets, mutate production data, create production logical-replication artifacts, change DNS, or deploy to ICP mainnet without the applicable approval gate in `PLANS.md`.

## Security invariants

The following are release-blocking invariants:

1. A logical payment obligation has one immutable operation ID and can cause at most one value transfer per asset/chain.
2. Unknown or ambiguous external-call results are reconciled against the authoritative ledger/chain before any retry with new transaction material.
3. Liabilities, reserves, available treasury balance, fees, paid amounts, and external balances reconcile exactly in integer base units. No status transition silently forgives or duplicates money.
4. Payment eligibility, KYC/liveliness holds, ban holds, compensation, destination snapshots, and policy versions are recorded with the payment intent and remain auditable.
5. Payout destinations are separate from login identities. Address changes require ownership proof where supported, step-up authorization, a delay for risky changes, and immutable history.
6. Use Internet Identity/caller principals as one of authentication mechanisms on par with OAuth.
6a. Use Motoko `indentify` package for OAuth.
7. Migration imports are authenticated, canonical, bounded, hash-verified, idempotent, resumable, and disabled after signed finalization. Re-importing the same chunk is a no-op; a different hash for the same chunk is rejected.
8. Source IDs and all historical rows, including unmanaged physical tables, are preserved or represented by an explicit, reviewed tombstone/exception. Secrets are the sole exception: values are rotated/retired, never broadly imported.
9. Authorization, financial, and migration constraints are enforced by application code and tested; they are not delegated to UI behavior or a best-effort document index.
10. Pause controls fail closed. Pausing never erases a liability, and ordinary admin paths cannot bypass a payment pause or immutable vault limit.
11. Production code and frontend assets are reproducibly built, their hashes are reviewed, and their deployed module/controller hashes are verified.
12. Development and CI are cryptographically unable to use production signing authority or real funds.

## Completion criteria

The migration is complete only when all of the following are true:

- Every item in `docs/icp/PARITY_CHECKLIST.md` is `VERIFIED`, `INTENTIONALLY_CHANGED` with an approved rationale, or `NOT_APPLICABLE`; none remain unknown or merely implemented.
- All 21 Prisma models, the unmanaged `ai_result_migration_exceptions` table, every relation/index/constraint, and all 17 explicit Prisma transactions have an implemented and tested ICP disposition.
- Canonical full export plus final delta import reconcile source/destination record counts and hashes; referential, uniqueness, status, and PII exception reports are clean or signed off.
- Financial history and balances pass the independent reconciliation in `docs/icp/MIGRATION_RUNBOOK.md`; ambiguous legacy payments are resolved without automated re-send.
- Authentication/authorization, upgrade compatibility, timer recovery, replay/reentrancy, migration resume, controller-compromise, cycle exhaustion, and chain reorg/finality tests pass.
- The React frontend is served as certified ICP assets with strict CSP and no untrusted executable content; it uses authenticated Candid actors rather than the legacy REST bearer-token path.
- Local, PocketIC, and each supported chain's testnet rehearsals pass using valueless/test assets. The full production migration is rehearsed from backup and the rollback procedure is timed and verified.
- Independent security review has no unresolved critical/high finding affecting custody, authorization, migration integrity, upgrades, or historical preservation.
- The four approval gates in `PLANS.md` are recorded, and the legacy application remains recoverable until the final rollback window closes.
