# M1 toolchain and OAuth package evidence

Status: M1 task 1 implemented on 2026-08-01. This is a compile-time, no-live-provider scaffold only; it does not authenticate users, persist OAuth attempts, configure a provider, retain a token, or authorize any application action.

## Reproducible toolchain

| Component | Exact pin | Verification |
| --- | --- | --- |
| DFX manifest | `0.32.0` | `dfx.json` requires the exact version |
| Motoko compiler | `0.16.3` | `mops.toml` and Mops-managed binary |
| Mops CLI | `ic-mops 2.19.2` | Exact root development dependency and `package-lock.json` integrity pin |
| Mops dependency closure | lockfile format 3 | `mops.lock`, including SHA-256 for every resolved package file |

`mops.lock` is the normative package-content lock. It resolves `identify@0.0.2` and every transitive package; an install with a changed file hash must fail rather than refresh this lock without review.

## `identify` package pin and API boundary

| Property | Evidence |
| --- | --- |
| Mops package | `identify@0.0.2` |
| Upstream source | `https://github.com/f0i/identify` |
| Upstream release tag | `0.0.2` → `81e843d641fe6ca49c453be38f1017ab7eb60e3a` (read-only `git ls-remote --tags --refs`) |
| Package manifest SHA-256 | `64319d0b9f91d8e0af1489d2e9d0b7ea2a760778df3df5130d1bda12f6562d18` |
| Public API entry source SHA-256 | `src/lib.mo` → `22fb166b9036d47df24f4ed4e3245415648b802f229789eb4ea19c45eb83a88f` |
| Complete package file hashes | `mops.lock.hashes.identify@0.0.2` |

The reviewed package entry point exports `init`, provider configuration methods, delegation preparation methods (including PKCE variants), delegation retrieval, user retrieval, and provider listing. Its API does **not** yet prove the M2 caller-bound attempt protocol. In particular, the package documentation says its PKCE methods use non-replicated HTTP outcalls and, for GitHub, require a backend client secret. M2 must retain the plan's caller/state/nonce/PKCE/configured-client/redirect/immutable-subject checks around this package and must not treat a package delegation, callback, code, or token as application authority.

## Provider capability matrix

This is a package-capability record, not approval to enable a provider. No row has a configured client, redirect URL, secret, token, or live validation result.

| Legacy provider | `identify@0.0.2` evidence | Flow/caller-binding disposition | Immutable subject / issuer-audience | Scopes and token retention | M1 outcome |
| --- | --- | --- | --- | --- | --- |
| GitHub | Documented generic PKCE support | PKCE is available, but the package's own documentation requires a backend client secret and warns about non-replicated outcalls. M2 must add the plan's caller-bound attempt and code-hash protocol. | Subject endpoint/configuration must be pinned and tested; OAuth does not inherently supply issuer/audience claims. | Undecided; discard immediately after subject verification unless G2 approves an encrypted, audited exception. | Block live enablement pending G2 proof and credential policy. |
| ORCID | Not listed as a supported provider in the package documentation. | Treat as unsupported: fixture rejects it until an exact compatible configuration/proof is added. | Unproven. | Unproven. | Retire or prove at G2; never silently downgrade. |
| Bitbucket | Not listed as a supported provider in the package documentation. | Treat as unsupported: fixture rejects it until an exact compatible configuration/proof is added. | Unproven. | Unproven. | Retire or prove at G2; never silently downgrade. |
| GitLab | Not listed as a supported provider in the package documentation. | Treat as unsupported: fixture rejects it until an exact compatible configuration/proof is added. | Unproven. | Unproven. | Retire or prove at G2; never silently downgrade. |

## Fixture scope and validation

`oauth_fixture` is a test-only canister surface. Its vector's `caller` is simulated test data and is explicitly not a Candid authority input. The real M2 method must receive its caller from `shared ({ caller })` and must persist a bounded, single-use attempt before any provider outcall.

The fixture has no external calls, credentials, OAuth code, verifier, token, client ID, client secret, redirect URL, user record, or durable authentication state. Its tests reject anonymous caller, caller swap, expiration, state swap, unsupported provider, and replay; only a matching, unexpired, one-use supported vector is accepted.

## Commands and rollback boundary

```sh
mops install --lock check
mops check
mops test
mops build
mops check-stable
```

Rollback removes only the undeployed manifests, empty interfaces, fixture, evidence, and lockfile. It does not affect the legacy Node.js/PostgreSQL application, production data, signing authority, or assets.
