# ICP deterministic serialization, version 1

## Compatibility policy

This document defines the bytes used for persistent keys, hashes, subaccounts,
allocation versions, transfer deduplication and audit identifiers. Implementations
in Motoko and TypeScript must share the fixture vectors in `icp/fixtures/v1`.

The committed interfaces in `icp/candid/v1` are the immutable v1 baseline.
Compatible changes within v1 are additive only. Removing a method or field,
changing a field type, changing a variant meaning, or changing any encoding below
requires a new version directory and migration code. Every canister reports semantic
version `1.0.0` and the SHA-256 digest of its exact UTF-8 `.did` file from
`interface_version`.

## Primitive codec

Canonical values are concatenated without padding unless stated otherwise.

| Value | Encoding |
|---|---|
| `Nat8`, `Nat16`, `Nat32`, `Nat64` | fixed-width unsigned big-endian |
| application timestamp | signed 128-bit two's-complement big-endian nanoseconds since Unix epoch |
| text | Unicode NFC, UTF-8, preceded by its `U32_BE` byte length |
| variable blob | `U32_BE` length followed by bytes |
| `Hash32` | exactly 32 raw bytes; reject any other length |
| optional | `00` for absent; `01 || value` for present |
| boolean | `00` false; `01` true |
| principal | one-byte raw-principal length followed by raw principal bytes |
| vector | `U32_BE` element count followed by canonical elements |
| record | fields in the explicit order specified by the purpose encoding |
| variant | stable `U16_BE` tag from the registry below, then its payload |

Reject invalid UTF-8, non-NFC input where normalization changes a value used as an
identifier, integer overflow, trailing bytes, duplicate record keys, and noncanonical
encodings. Candid's wire encoding and source declaration order are never used as the
canonical hash encoding.

## Hashing and domains

`H(x)` means SHA-256 over `x`. Each purpose starts with:

```text
domain(purpose) = UTF8("meritocracy/icp/v1/" || purpose) || 00
```

Purpose names are lowercase ASCII and are never localized. A digest for one purpose
must not be reused for another purpose even if the remaining bytes match.

## Stable variant tags

Network: `icp=0`, `bitcoin=1`, `ethereum=2`, `solana=3`, `polkadot=4`,
`stellar=5`, `cosmos=6`, `bitcoin_cash=7`, `other=65535` (followed by text).

Session issuer: `ethereum_wallet=0`, `internet_identity=1`, `oauth=2` (OAuth is
followed by its normalized provider identifier). Transfer state: `prepared=0`,
`executing=1`, `sent=2`, `retryable_failure=3`, `permanent_failure=4`.

Tags are append-only. Removed meanings remain reserved forever.

## Identifier encodings

```text
user-id = U64_BE(user_id)

asset-id = principal(ledger)
        || U8(decimals)
        || text(uppercase ASCII symbol)

fund-id = H(domain("fund") || canonical-fund-source)

route-key = H(domain("route")
           || U16_BE(network-tag) || network-payload
           || optional(asset-id))

vault-subaccount = H(domain("vault-subaccount")
                  || asset-id
                  || fund-id
                  || U64_BE(round_id))
```

`fund-id`, route keys and vault subaccounts are exactly 32 bytes. An ICRC account is
encoded as `principal(owner) || optional(fixed 32-byte subaccount)`.

## Allocation versions and transfers

Allocation entries are sorted by unsigned `allocation_id`, ascending. Duplicate IDs
are invalid. Each entry is:

```text
U64_BE(allocation_id)
|| U64_BE(user_id)
|| asset-id
|| unsigned-big-nat(amount_atoms)
|| Hash32(evidence_hash)
|| optional(Hash32(recipient_snapshot_hash))
```

`unsigned-big-nat(n)` is `U32_BE(byte_count)` followed by the shortest unsigned
big-endian magnitude; zero has byte count zero. Leading zero bytes are invalid.

```text
allocation-version = H(domain("allocation-version")
                     || U64_BE(round_id)
                     || U32_BE(allocation_count)
                     || sorted-allocation-entries)

memo = H(domain("allocation-memo")
      || U64_BE(round_id)
      || U64_BE(allocation_id)
      || Hash32(allocation-version))
```

`created_at_time` is the unsigned `Nat64` nanosecond timestamp captured once when a
transfer first enters `Prepared`. The memo and timestamp are persisted before the
first ledger call and reused unchanged for every retry. They are not derived from
timer delivery or retry time. The ledger block index is the authoritative receipt.

## Other deterministic identities

```text
recipient-snapshot-hash = H(domain("recipient-snapshot")
                         || U64_BE(user_id)
                         || U64_BE(payout_account_id)
                         || route-key
                         || blob(normalized_address_bytes))

audit-event-id = H(domain("audit-event")
                 || principal(origin_canister)
                 || U64_BE(origin_monotonic_event_id)
                 || Hash32(payload_hash))

idempotency-key = H(domain("idempotency/" || operation-name)
                  || principal(authenticated_session_principal)
                  || canonical-request-body)
```

Operation names are committed lowercase ASCII method names. A caller-supplied
idempotency key is accepted only when exactly 32 bytes and is always scoped to the
authenticated principal and method before storage.

## Addresses and time

Every network adapter owns a separately versioned normalization function. Store the
submitted display address and normalized form, but use normalized bytes for conflict
checks, recipient snapshots and route uniqueness. Until an adapter has passed Stage
9, that network's address cannot become an active payable route.

Application timestamps are signed nanoseconds in Candid `int`. ICRC
`created_at_time` is unsigned nanoseconds in `nat64`. Seven days is exactly
`604800000000000` nanoseconds. Leap seconds do not change elapsed-duration
arithmetic.

## Authority-sensitive constraints

- Only the configured `rounds` principal may call vault reservation, execution and
  reconciliation mutations.
- Ethereum login challenges are generated by the registry and bind the normalized
  address, target session principal, allowed application domain, allowed requested
  action, nonce and expiry. Completion accepts a 65-byte Ethereum `r || s || v`
  signature (`v` is 27 or 28) and the corresponding 65-byte SEC1 uncompressed
  public key. It verifies
  the signature over the EIP-191 Keccak-256 digest of the exact returned message,
  derives the Ethereum address from `Keccak-256(public_key[1..65])`, and compares
  its final 20 bytes with the challenged address. It never accepts a claimed user
  identifier or relies on an unaudited public-key recovery implementation.
- Internet Identity login treats the authenticated ingress caller as the II
  subject. That caller explicitly authorizes the target session principal named in
  the request; an opaque browser-supplied assertion is never accepted as identity.
- `begin_oauth_login` must be called by its target session principal. It returns an
  opaque, expiring attempt and the registry's `liminal` login URL. PKCE verifier,
  authorization code and provider tokens remain inside the HTTP middleware flow.
  The `liminal` callback resolves a validated immutable provider subject, consumes
  the bound attempt and immediately discards all provider credentials. The browser
  has no Candid OAuth-completion method.
- OAuth redirect targets and providers are allowlisted. OAuth state and attempts
  expire and are single-use; only `(provider, subject)` identity bindings survive in
  stable state.
- The vault has no arbitrary transfer, withdrawal or sweep encoding/API.
- Raw KYC data, email/OAuth tokens, provider credentials, private keys and legacy
  secrets are not canonicalized because they must never enter replicated state.
- Money is `Nat` atoms. Weights are explicit integer numerator/denominator pairs.
  `Float`, decimal floating point, and JavaScript `number` are forbidden for money.
