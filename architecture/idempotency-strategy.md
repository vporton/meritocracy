# Idempotency strategy

## Contract

Every mutating core command accepts an opaque idempotency key, except an internally
generated transition that is already uniquely keyed by a durable Work item; that
transition still records its work/attempt key. The command receipt, authoritative
write, affected indexes/projection, and redacted audit event commit atomically in one
no-await update (INV-024). A caller retry therefore cannot turn an uncertain network
response into a duplicate mutation.

## Keys and IDs

|Use|Format/owner|Notes|
|---|---|---|
|Public command key|Caller-supplied opaque 128-bit-or-stronger random value, encoded canonically; scoped to `(caller principal, command kind)`|Do not use timestamps, email, or predictable counters. Exact byte/length limits are **UNKNOWN** and must be policy-capped.|
|Command receipt ID|Server-derived `v1:cmd:<caller-hash>:<command-kind>:<key-hash>`|Receipt stores request fingerprint, result/error class, created/completed time, entity IDs and audit correlation ID; no raw sensitive input.|
|Assessment run/work ID|Server deterministic from account + command receipt/key + policy/schema version|Caller cannot choose the resulting entity ID; a retry receives the original run.|
|Vote identity|Server composite `(periodId,targetAccountId,voterAccountId)` plus command receipt|The domain uniqueness key is a stronger duplicate guard than an arbitrary retry key.|
|Allocation/obligation/memo|Server deterministic from canonical period + account + asset + pinned policy + allocation idempotency scope|Receipt/memo index is unique. Legacy timestamp identity is explicitly rejected.|
|Worker callback/event key|Producer-supplied signed event/result ID, scoped to worker identity and workflow ID|Worker callback also carries expected state/version.|
|Provider webhook key|Provider event ID or verified credential-consumption ID, stored off-chain and at core attestation boundary|If provider does not supply a stable ID, replay-safe derivation is **UNKNOWN**; do not accept callbacks until defined.|
|Migration key|`v1:mig:<snapshot-id>:<source-table>:<source-row-hash>:<transform-version>`|A changed transformation is deliberately a new key and needs explicit migration authority.|

## Stored-result and replay behavior

- The first valid request reserves the receipt key and commits its result atomically.
- A later request with the same scoped key and identical canonical request fingerprint
  returns the stored typed result, including terminal rejection where recording that
  rejection is policy-approved. It does not append a second business audit event.
- The same key with a different command kind, caller scope, or fingerprint returns
  `Conflict(idempotency_key_reused)` and emits only a security/operational audit fact
  if policy permits.
- A key whose first attempt failed before commit has no receipt and may be retried.
  A caller that cannot distinguish timeout from commit simply retries the same key.
- Idempotency does not replace optimistic concurrency: profile, policy, lease, period,
  reserve, and callback transitions additionally require `expectedVersion`/state.
- Internal duplicate guards (identity commitment, vote composite key, active run key,
  allocation key, receipt/memo key) are always checked even with a fresh caller key.

## Retention and cleanup

Financial, governance, migration, identity-binding, work/result, and external-send
receipts are retained at least through the life of the referenced immutable record;
payment memo/receipt and migration receipts must remain available for reconciliation.
The exact retention periods, legal holds, and storage budget are **UNKNOWN** in the
source evidence. Until governance sets them, do not delete such receipts.

For low-risk, completed public-command receipts, governed bounded compaction may move
the response to an immutable digest/archive only after the configured retry window.
The window value is **UNKNOWN**; cleanup must be cursor-bounded, preserve a tombstone
digest sufficient to reject key reuse, and append an audit record. Never delete a
receipt while its Work item, active lease, or external effect can still be replayed.

## Collision, abuse, and security

- Treat a receipt-key collision with mismatched fingerprint as a conflict, never as a
  successful replay. Deterministic entity-ID collision likewise checks the complete
  canonical inputs and traps only for impossible internal cryptographic corruption.
- Bind public keys to the authenticated caller and command type to prevent one
  principal probing or replaying another's receipt. Do not expose receipt existence or
  stored restricted results to an unauthorized caller.
- Hash keys and sensitive request fields in audit/receipt metadata; do not put email,
  token, provider credential, private address, raw prompt, or secret in stable state.
- Enforce bounded key sizes and per-caller outstanding receipt/work quotas to prevent
  stable-memory exhaustion; values are **UNKNOWN** pending capacity policy.
- Worker/provider/executor keys require authenticated identities and narrow workflow/
  kind scopes. A callback is never authorized merely because it knows an ID.
- Reconciliation observations are idempotent by `(obligationId, observationId)` and
  unique receipt/memo, but an ambiguous send remains `reconcile_required`; replay
  protection must never authorize automatic payment resend.
