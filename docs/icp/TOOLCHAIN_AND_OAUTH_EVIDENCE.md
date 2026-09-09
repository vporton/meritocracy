# M1 toolchain and OAuth package evidence

Status: M1 task 1 implemented on 2026-08-01. This is a compile-time, no-live-provider scaffold only; it does not authenticate users, persist OAuth attempts, configure a provider, retain a token, or authorize any application action.

## Reproducible toolchain

| Component | Exact pin | Verification |
| --- | --- | --- |
| DFX manifest | `0.32.0` | `dfx.json` requires the exact version |
| Motoko compiler | `1.4.1` | `mops.toml` and Mops-managed binary |
| Mops CLI | `ic-mops 2.19.2` | Exact root development dependency and `package-lock.json` integrity pin |
| Mops dependency closure | lockfile format 3 | `mops.lock`, including SHA-256 for every resolved package file |

`mops.lock` is the normative package-content lock for registry and Git
dependencies. It records the approved local `identify` fork path plus every
transitive registry/Git dependency; the fork's deterministic tree-hash verifier
is its corresponding content pin because Mops does not hash local paths in the
lockfile. An install with a changed registry/Git file hash must fail rather than
refresh this lock without review.

### Approved compatibility fork and current integration blocker

On 2026-09-09, the owner approved the minimal audited compatibility fork at
`packages/identify-m1-compat`, exposed under the unchanged root import name
`identify`. It derives only from released `identify@0.0.2` and makes precisely
two source-level changes: it excludes the non-library frontend E2E actor
fixtures that Motoko 1.4 rejects in a package path, and changes all 103 backend
`mo:core/...` imports to explicit `mo:core@1/...` imports. The public
`src/lib.mo` entry is byte-identical to upstream. It adds no provider, client,
credential, callback, token, authorization method, storage method, target
data, deployment, or alternate compiler.

`scripts/icp/verify-identify-m1-compat.sh` proves that exact delta by
normalizing the only permitted Core-import change and comparing its resulting
source-tree hash with the released source baseline. It also proves the absence
of frontend E2E fixtures, explicit Core 1 binding, root/lock selection, and the
hashes below. It is self-contained and performs no network call. `mops test
OAuthAttempt` passes all caller/state/expiry/replay/unsupported-provider vectors
after the fork.

The fork clears the original `counter.mo` blocker, but a full `mops check`
now reaches a distinct existing transitive Motoko 1.4 incompatibility in
`hex@1.0.2` (`Text.join`'s changed iterator API). This is not within the
approved identify-fork scope. Do not patch, replace, or bypass `hex` without a
new explicit decision and its own source/package/API review. Consequently no
combined ZenDB/identify target build, storage integration, Candid update, or
stable-type change is claimed.

The Mops ZenDB package declares version-qualified Core 2.4 imports. The
separate exact-source remote-CanisterDB probe remains a different historical
candidate with its own lock and source pin; it is not validation evidence for
the Mops package closure or target storage integration.

## `identify` upstream pin, fork hashes, and API boundary

| Property | Evidence |
| --- | --- |
| Upstream Mops package | `identify@0.0.2` (pre-fork source baseline) |
| Upstream source | `https://github.com/f0i/identify` |
| Upstream release tag | `0.0.2` → `81e843d641fe6ca49c453be38f1017ab7eb60e3a` (read-only `git ls-remote --tags --refs`) |
| Package manifest SHA-256 | `64319d0b9f91d8e0af1489d2e9d0b7ea2a760778df3df5130d1bda12f6562d18` |
| Public API entry source SHA-256 | `src/lib.mo` → `22fb166b9036d47df24f4ed4e3245415648b802f229789eb4ea19c45eb83a88f` |
| Complete upstream package file hashes | The exact pre-fork M1 lock record; the normalized source baseline and all fork package hashes below are the current reproducible evidence |

| Fork property | Evidence |
| --- | --- |
| Local package | `identify-m1-compat@0.0.2-m1.1`, resolved as root dependency `identify = "./packages/identify-m1-compat"` |
| Fork manifest SHA-256 | `b900adff96b85400fcc2f4f3d4d8fee02fbbc6bd6d9d8fc23aabcc1c28be48c0` |
| Fork source-tree SHA-256 | `afbbb093f50dcffbe1c789678c5f7b56c15fc0feb5850e13cc575e0ad4e8672d` |
| Normalized upstream-equivalence source SHA-256 | `23260cda1aa97886bc63e77bbcc3fa906f5d65b8e2f3d899408adaa98bf2f93c` — replacement of `mo:core@1/` with `mo:core/` produces the released source tree with its frontend E2E fixtures omitted |
| Complete fork package-tree SHA-256 | `6cfd21aabb9e848dd67c1d463ecfb75c94c0a9c7b56fe8b0fbd1d87ae272a32f` |
| Public API entry source SHA-256 | `src/lib.mo` → `22fb166b9036d47df24f4ed4e3245415648b802f229789eb4ea19c45eb83a88f` (identical to upstream) |
| Exact-delta verifier | `scripts/icp/verify-identify-m1-compat.sh` |

The Mops local-path mechanism does not insert local package file hashes into
`mops.lock`; the verified tree hashes above are therefore the compatibility
fork's package-content pin. The normalized released-source baseline was derived
from the exact `identify@0.0.2` lock record and is embedded in the verifier, so
verification does not depend on an ambient Mops cache or Git history. The
verifier rejects every source difference except the required Core import
qualification, and rejects added source files or restored E2E fixtures.

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
scripts/icp/verify-identify-m1-compat.sh
mops install --lock check
mops test OAuthAttempt
mops check # currently fails only at the separately unapproved hex@1.0.2 issue
```

No Candid interface or committed stable signature changed in this task:
`git diff --name-only -- 'canisters/**/*.did' 'deployed/*.most'` is empty.
Full `mops check`, build, and stable checks cannot yet be re-established until
the separately approved `hex` compatibility disposition exists; their failure
must not be papered over with a second compiler or a wider fork.

Rollback restores the released `identify@0.0.2` Mops dependency and removes
only this undeployed local fork, its verifier, evidence, and regenerated lock.
It does not affect the legacy Node.js/PostgreSQL application, production data,
signing authority, assets, OAuth providers, or user identities.
