# API mapping

`meritocracy_core` is the only business canister. Browser callers use generated Candid bindings and ICP principal/delegation authentication. Anonymous is accepted only where stated. Every list is cursor-paginated (maximum comes from active policy), and each row is ordered deterministically by the ordering below with the immutable ID as a final tie-breaker. Public decision facts use the certified query methods; ordinary query output is display-only.

|Existing endpoint|Target method|Call type|Canister|Authentication|Authorization|Result type|Intentional differences|
|---|---|---|---|---|---|---|---|
|`GET /`|asset HTTP `/`|certified HTTP response|assets|anonymous|public|asset response|SPA/banner becomes a versioned certified asset; it is not a core API method.|
|`GET /api/users`|removed|removed|—|—|—|—|Unbounded PII/KYC enumeration is incompatible with replicated state/privacy.|
|`POST /api/users`|off-chain identity enrollment|off-chain API|identity service|provider/browser proof|identity policy|private enrollment result|Email/user records and sessions cannot be held in a canister.|
|`GET /api/users/leaderboard`|`list_leaderboard`|query|core|anonymous|public consented projection|paged profiles|Cursor replaces limit; order `share_e8 DESC, account ASC`; no unconsented fields.|
|`GET /api/users/salary-stats`|`get_certified_reserve_aggregate` + `get_certified_public_status`|certified query|core|anonymous|public redacted aggregate|certified result|Legacy GDP salary snapshot is not canonical; only governed aggregate is exposed.|
|`GET /api/users/{id}`|`get_public_profile`|query|core|anonymous|public consented projection|profile result|Numeric IDs become principals; KYC/email/reasons are removed.|
|`PUT /api/users/{id}`|`update_my_profile`|update|core|principal|owner|profile result|No path-owner ambiguity; only consented, bounded fields; optimistic version/idempotency required.|
|`DELETE /api/users/{id}`|`tombstone_my_account`|update|core|principal|owner|empty result|Tombstone plus durable off-chain erasure work replaces immediate session/email deletion.|
|`GET /api/users/me/gdp-share`|`get_my_account`|query|core|principal|owner|account view|Share is fixed-point `share_e8`, not nullable DB decimal.|
|`POST /api/evaluation/start`|`request_assessment`|update|core|principal|eligible owner|assessment result|Returns durable requested run; it never synchronously calls AI. Retry is `retry_assessment`.|
|`GET /api/ban-voting`|`list_vote_periods` / `get_certified_vote_period`|query / certified query|core|anonymous|public aggregate only|period result|Votes/messages/identity are restricted; certified aggregates replace dynamic service shape.|
|`POST /api/ban-voting/vote`|`submit_vote`|update|core|principal|eligible non-self voter|vote receipt|Canonical period, expected version, and idempotency prevent weekly duplicate/races.|
|`GET /api/ban-voting/{userId}/assessments`|`list_vote_periods`|query|core|anonymous|public aggregate|paged periods|Numeric user is principal; no raw assessment details; order `opens_at DESC, period_id ASC`.|
|`POST /api/auth/login/{provider}`|off-chain identity verification|off-chain API|identity service|provider proof|identity policy|private auth result|Direct social-handle login is removed: proof/OAuth validation is required.|
|`POST /api/auth/register/email`|off-chain identity enrollment|off-chain API|identity service|email proof|identity policy|private result|Canister does not send mail/store email.|
|`POST /api/auth/verify/email`|off-chain verification then `propose_attestation`|off-chain + internal update|identity service/core|verification token then worker principal|allow-listed worker|attestation decision|Tokens and PII stay off-chain; core receives only commitment.|
|`POST /api/auth/resend-verification`|off-chain resend|off-chain API|identity service|private identity auth|identity policy|accepted request|Email delivery is an external private workflow.|
|`POST /api/auth/logout`|frontend-only|frontend-only|browser|delegation identity|owner|local logout|Discard delegation; no server session exists.|
|`GET /api/auth/me`|`get_my_account`|query|core|principal|owner|account view|No email/provider/KYC PII in core response.|
|`GET /api/auth/kyc/status`|off-chain private KYC status|off-chain API|KYC service|private identity auth|identity policy|private status|Government identity data must not be replicated.|
|`GET /api/auth/{provider}/callback`|off-chain OAuth callback|off-chain API|identity service|OAuth state|provider policy|redirect|HTTP redirect/secrets are unsuitable for Candid.|
|`POST /api/auth/disconnect/{provider}`|off-chain disconnect + `tombstone_my_account` where needed|off-chain/update|identity service/core|principal/private identity|owner|private result/core receipt|Provider credentials/links remain private; core only applies an allowed state change.|
|`POST /api/auth/kyc/didit/callback`|off-chain webhook then `propose_attestation`|off-chain + internal update|KYC service/core|webhook signature, worker principal|allow-listed worker|attestation decision|No public webhook endpoint or raw KYC payload.|
|`POST /api/auth/kyc/initiate`|off-chain KYC initiation|off-chain API|KYC service|private identity auth|identity policy|redirect/session|Provider session and URL are secret-bearing.|
|`DELETE /api/auth/sessions/cleanup`|removed|removed|—|—|—|—|Sessions do not exist after delegation cutover.|
|`GET /api/global/gdp`|`get_certified_public_status`|certified query|core|anonymous|public policy-approved fact|certified result|Only a governed/attested value is exposed, with version/certificate.|
|`POST /api/global/refresh-gdp`|`propose_oracle_observation`|internal update|core|oracle worker principal|allow-listed worker|observation receipt|Anonymous fetch/write is removed; fetching happens off-chain.|
|`GET /api/global/token-prices`|off-chain market-data API|off-chain API|oracle service|anonymous or app key|rate policy|quote page|Live arbitrary symbols are not authoritative core state.|
|`GET /api/logs`, `/api/logs/stats`, `/api/logs/types`|removed|removed|—|—|—|—|Raw logs and request/response data are private/off-chain; no public replacement.|
|`GET /api/logs/my`, `/api/logs/user/{userId}`|off-chain private audit portal|off-chain API|operations service|principal/private auth|owner/auditor|redacted page|Core exposes no raw prompts/tokens; portal uses bounded redacted exports.|
|`GET /api/cleanup/stats`, `POST /dry-run`, `POST /execute`|`run_maintenance_batch`|internal update|core|governance principal|governance only|batch receipt|System-wide destructive cleanup cannot be invoked by any user; each batch is bounded.|
|`GET /api/admin/status`|`get_public_status` (redacted) / governed audit portal|query/off-chain|core/ops|anonymous or governance|public/governance|status|Password header is removed; sensitive operational state is restricted.|
|`POST /api/admin/toggle-distribution`|`activate_policy`|internal update|core|governance principal|governance|receipt|Versioned policy replaces mutable password-protected flag.|
|`POST /api/admin/trigger-distribution`|`create_payment_obligation` + executor workflow|internal update|core|governance principal|governance|receipt|No direct transfer; allocation is atomic then executor claims it.|
|`POST /api/admin/trigger-re-worth-assessment`|`request_assessment` / governed batch|update/internal update|core|principal/governance|owner or governance|assessment/receipt|Async work replaces synchronous task execution.|
|`GET /api/multi-network-gas/{operation}`, `/network/...`, `/user/.../history`|`get_public_status`, `get_certified_reserve_aggregate`, `list_my_obligations`|query/certified query|core|anonymous for aggregates; principal for history|public aggregate/owner|typed views|Dynamic operation switch and public per-user history are removed; history is owner-only, order `created_at DESC, obligation_id ASC`.|
|`POST /api/multi-network-gas/run-distribution`|`create_payment_obligation`|internal update|core|governance principal|governance|receipt|Anonymous financial execution is removed; one obligation/allocation key per entitlement.|
|`POST /api/multi-network-gas/ensure-country-account`, `/ensure-region-account`|removed|removed|—|—|—|—|Wallet secrets belong only in an off-chain secret manager; core never creates/stores them.|
|`GET /api/cron/status`|`get_public_status`|query|core|anonymous|public redacted|status|Schedules are off-chain; no internal job metadata is public.|
|`POST /api/cron/{job}`|governed scheduler invokes `run_maintenance_batch`, `finalize_vote_period`, or `create_payment_obligation`|internal update|core|scheduler governance principal|method-specific governance|receipt|Header secret/background fire-and-forget is replaced by bounded, idempotent commands and workflow state.|

## Contract-wide rules

- Candid service version is major/minor; methods return the relevant policy/entity versions. A new major is required for semantic breaking changes.
- Default page limit and maximum are policy-defined. Invalid/expired cursors produce `invalid_input`; cursors bind the sort/filter and cannot be reused with different filters.
- Update methods authenticate from `msg.caller`; no caller principal is accepted in an owner request. Governance and workers are separate internal interfaces and allow-lists/roles.
- Existing endpoint responses are intentionally not byte-compatible. The migration adapter, if retained, maps typed variants to HTTP status codes from `error-model.md` and cannot reintroduce sensitive fields.
