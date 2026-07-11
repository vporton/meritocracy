# API contract test plan

Run these tests against the generated bindings for `candid/public.did` and each `candid/internal/*.did`, with a replica that supports certified-query verification. Include anonymous, owner, unrelated principal, governance principal, identity worker, evaluation worker, executor worker, revoked worker, and malformed delegation fixtures.

## Candid compatibility

- Pin the checked-in DID files and run a Candid compatibility checker in CI. Minor candidate interfaces may add methods, optional record fields, and variant arms only; reject removed/renamed fields, changed field types/units, altered result variants, or changed method modes.
- Generate TypeScript and Rust bindings from every DID, compile a small consumer for each, and assert method names, explicit request records, result variants, `nat` amounts, `nat64` timestamps/version fields, and optional fields serialize as expected.
- Decode fixture replies produced by the prior compatible minor interface with the candidate interface and vice versa where Candid subtyping permits it. Verify public version and policy-version fields are present for decision-relevant outputs.

## Behavioral equivalence and migration differences

- Build fixtures from every row in `api-mapping.md`: verify the mapped safe behavior (leaderboard, owner profile, assessment request, vote, public status, obligation history) and assert each marked removed/frontend-only/off-chain route has no core method or is rejected by the HTTP compatibility adapter.
- Assert deliberate changes: no full user list, no PII/KYC/session/log output, no anonymous financial/admin/cleanup action, no direct social handle login, no synchronous AI evaluation, no numeric account ID contract, and no public account obligation history.
- Verify certified public status, reserve aggregate, and period facts with valid certificates/witnesses; corrupt witness/certificate and assert client verification fails rather than treating it as ordinary query data.

## Serialization and errors

- Round-trip every public/internal request/result through Candid encoding, including empty optionals, maximum bounded strings/vectors, Unicode display names, principals, blobs, large `nat` amounts, and `nat64` timestamps.
- Fuzz malformed cursors, oversized source lists/messages, invalid enum/record encodings, out-of-range limits, duplicate fields at adapter boundaries, and unknown future optional data. Assert typed `invalid_input`, never a trap.
- For every `ErrorCode`, induce a representative path and assert stable code, safe message, retryability, optional safe field/correlation ID, and absence of provider/database/raw error text. Validate HTTP adapter status mapping where it exists.

## Pagination and ordering

- Seed ties and verify `list_leaderboard` is `share_e8 DESC, account ASC`; period lists are `opens_at DESC, period_id ASC`; obligation/assessment history is `created/requested_at DESC, immutable_id ASC`.
- Traverse all pages with limits 1, default, and maximum: no omission/duplication; a replayed cursor returns the same boundary; invalid, expired, or filter-mismatched cursor is `invalid_input`; unbounded list requests cannot be encoded.
- Mutate data between pages and verify documented snapshot/cursor behavior (stable ordering, no duplicated boundary); exercise page/resource limit errors.

## Authentication, authorization, and idempotency

- Call each public query anonymously and assert only designated public projections/aggregates are returned. Call every owner, governance, and worker update anonymously and expect `unauthenticated`.
- Exercise owner vs unrelated principal, tombstoned/restricted account, eligible/ineligible/self voter, governance vs ordinary user, each worker role vs wrong/revoked worker, and executor attempts to alter amount/destination. Expect `unauthorized`, `not_found`, or `invalid_state_transition` without mutation.
- Replay each update/callback with identical idempotency/event/result/observation key and assert same receipt plus `duplicate=true`; reuse a key with different payload and expect `conflict`. Race duplicate votes, stale expected versions, period close, assessment callbacks, allocation, execution lease, and settlement observations.
- Verify payment ambiguity results in `reconcile_required`, never a second execution instruction; unavailable dependencies produce retryable typed errors without an unsafe state transition.
