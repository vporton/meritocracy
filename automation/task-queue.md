# Migration task queue

This queue is an intake register, not an approval mechanism. Per
`development/ownership.md`, no task below may move to `APPROVED` or `MERGED` without
the matching named human approver(s). Every implementation task must first have a
completed record based on [task-template.md](task-template.md).

## Queue

### S1-01 — Public read projection foundation

- **Phase:** S1
- **Vertical slice:** S1 — versioned public assets and public-profile read projection
- **Dependencies:** asset-canister release process; approved public-field and
  fixed-point conversion policy; operational runbook (`B-001`).
- **Risk:** medium (public-data/privacy boundary).
- **Permitted files:** to be set in the approved task record; no implementation
  allowlist has been approved.
- **Required tests:** existing banner/leaderboard characterization; certificate,
  deterministic cursor/tie-breaker, PII omission, snapshot reconciliation, and
  legacy-adapter tests.
- **Status:** PROPOSED.
- **Human approval requirement:** ICP architecture, security, migration/data,
  frontend, and operations owners.

### S2-01 — Principal account claim and profile lifecycle

- **Phase:** S2
- **Vertical slice:** S2 — principal account claim and consented profile CRUD
- **Dependencies:** S1; S3 verified identity service; deletion/retention policy;
  `B-001`.
- **Risk:** high (ownership, privacy, deletion).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** owner/cross-owner behavior; principal-only ownership;
  idempotency/version conflict; consent/tombstone/erasure; atomic projection.
- **Status:** PROPOSED.
- **Human approval requirement:** security, migration/data, ICP architecture, and
  frontend owners.

### S3-01 — Private identity and verification boundary

- **Phase:** S3
- **Vertical slice:** S3 — private identity, OAuth/KYC, email, and notifications
- **Dependencies:** worker allow-list; provider validation/PKCE/webhook replay;
  retention policy; `B-001`.
- **Risk:** high (PII, credentials, authentication).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** OAuth/PKCE/issuer; webhook replay; expiry/single-use;
  allow-list; attestation lifecycle; PII/secret exclusion.
- **Status:** PROPOSED.
- **Human approval requirement:** security, migration/data, ICP architecture, and
  operations owners.

### S4-01 — Assessment state-machine foundation

- **Phase:** S4
- **Vertical slice:** S4 — asynchronous assessment workflow and accepted result
- **Dependencies:** S2/S3; approved assessment/appeal policy; worker signing;
  evidence size/retention policy; `B-001`.
- **Risk:** high (private evidence and financial eligibility).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** state machine/idempotency; worker replay; bounded documents;
  acceptance atomicity; provider failure/retry.
- **Status:** PROPOSED.
- **Human approval requirement:** financial/governance, security, migration/data,
  and ICP architecture owners.

### S5-01 — Governance vote and maintenance workflow

- **Phase:** S5
- **Vertical slice:** S5 — governance voting, outcomes, holds, and maintenance
- **Dependencies:** S2/S3; approved vote privacy/quorum/appeal/clock policy; S4 if
  assessment gates voting; `B-001`.
- **Risk:** high (governance and payment holds).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** duplicate/self/ineligible vote; period boundary; concurrency;
  finalization/appeal; certified aggregate; bounded maintenance.
- **Status:** PROPOSED.
- **Human approval requirement:** financial/governance, security, ICP architecture,
  migration/data, and operations owners.

### S6-01 — Governed policy and reserve accounting

- **Phase:** S6
- **Vertical slice:** S6 — governed oracle/policy and reserve accounting
- **Dependencies:** S5; governance controller/multisig; approved fixed-point,
  conservation, and oracle freshness policy; `B-001`.
- **Risk:** high (financial state).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** singleton/version authorization; stale/conflicting oracle;
  conversion boundaries; reserve reconciliation; certification.
- **Status:** PROPOSED.
- **Human approval requirement:** financial/governance, security, ICP architecture,
  migration/data, and operations owners.

### S7-01 — ICP/ICRC obligation settlement

- **Phase:** S7
- **Vertical slice:** S7 — ICP/ICRC-1 obligation and ledger settlement
- **Dependencies:** S5/S6; approved custody, ledger/token, memo, finality, and
  reconciliation policy; `B-001`.
- **Risk:** high (irreversible financial effects).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** persist-before-await; ledger rejection/timeout; duplicate memo;
  ambiguous transfer; finality; conservation; reconciliation.
- **Status:** PROPOSED.
- **Human approval requirement:** financial/governance, security, ICP architecture,
  migration/data, and operations owners; explicit approval before any transfer.

### S8-01 — External-chain execution boundary

- **Phase:** S8
- **Vertical slice:** S8 — non-ICP external-chain execution
- **Dependencies:** S7; per-chain custody/consent/finality decisions; independent
  receipt verification; `B-001`.
- **Risk:** high (keys and irreversible transfers).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** signed instruction; duplicate handling; HSM access; RPC
  disagreement/reorg; receipt verification; emergency pause.
- **Status:** PROPOSED.
- **Human approval requirement:** financial/governance, security, ICP architecture,
  migration/data, and operations owners; explicit approval before broadcast.

### S9-01 — PostgreSQL retirement readiness

- **Phase:** S9
- **Vertical slice:** S9 — PostgreSQL retirement and retained private operations
- **Dependencies:** S1–S8 completed; retention/legal approval; approved export,
  restore, and incident runbook; `B-001`.
- **Risk:** high (data retention and irreversible cutover).
- **Permitted files:** to be set in the approved task record.
- **Required tests:** end-to-end replacement; archive restore; no legacy traffic;
  retention/erasure evidence; disaster recovery.
- **Status:** PROPOSED.
- **Human approval requirement:** all applicable owners, including legal/retention
  decision maker, security, migration/data, ICP architecture, and operations.
