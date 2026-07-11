# API error model

Every Candid method returns an explicit `variant { ok; err }`; expected failures never use traps. `err` is the public `ApiError` record in `candid/public.did` and every internal DID. `message` is a stable, non-sensitive client message, `field` identifies an invalid request field when safe, and `correlation_id` is opaque. Implementations must never return database/provider errors, stack traces, credentials, PII, transaction payloads, or raw error strings.

|Variant|Meaning and public message rule|Retryable|Typical mapping|
|---|---|---:|---|
|`invalid_input`|Malformed, out-of-range, oversize, unsupported, or invalid cursor/request field.|No|HTTP 400|
|`unauthenticated`|No caller principal/delegation where a non-anonymous caller is required.|No|HTTP 401|
|`unauthorized`|Caller is authenticated but lacks ownership, role, worker allow-list, or policy permission.|No|HTTP 403|
|`not_found`|The requested public/restricted resource does not exist or is not visible to the caller.|No|HTTP 404|
|`conflict`|A version/precondition/index collision prevents a safe write.|Usually no|HTTP 409|
|`duplicate_operation`|An idempotency/event/composite key was already accepted. The API returns its stored receipt when one is available; this variant is used only when replaying it is unsafe or unavailable.|No|HTTP 409 (legacy adapter); Candid normally returns `ok.duplicate=true`|
|`invalid_state_transition`|The resource exists but its current lifecycle state does not permit the command.|No|HTTP 409|
|`resource_limit`|A rate, page-size, payload, bounded-source, reserve, or cycle/resource policy limit was reached.|Sometimes|HTTP 429 or 413|
|`external_dependency_unavailable`|Ledger, executor, oracle, identity provider, or worker is unavailable; no unsafe state transition was asserted.|Yes|HTTP 503|
|`temporary_failure`|Retry-safe transient condition, including a lease race or temporary overload.|Yes|HTTP 503|
|`internal_invariant_violation`|Validated state violates a core invariant. The entity is quarantined/audited where applicable.|No for caller|HTTP 500|

## Error and idempotency rules

- Validation occurs before mutation. `expected_*_version` mismatches are `conflict`; a closed/deleted/terminal lifecycle is `invalid_state_transition`.
- Principal authentication is supplied by IC agent identity, not a Candid field. Anonymous queries are allowed only for explicitly public methods. Calling an owner/worker/governance update anonymously returns `unauthenticated`.
- Every public and privileged update includes a bounded opaque `idempotency_key`; worker callbacks use producer `event_id`, `result_id`, or `observation_id`. A same-key replay with equivalent payload returns the original typed success receipt with `duplicate=true`; a key reused for a different payload is `conflict`.
- At-least-once payment callbacks never cause an automatic resend after ambiguity. The result is `reconcile_required` in the obligation view; unavailable observation is `external_dependency_unavailable` or `temporary_failure`.
- Candid minor versions only add optional fields, methods, and variant arms. Removing/renaming fields, changing numeric units, reordering cursor semantics, or altering authorization requires a new major service/versioned method. Public responses expose `ApiVersion`/policy versions where externally material.
