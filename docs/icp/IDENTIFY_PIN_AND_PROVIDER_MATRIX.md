# `identify` pin and OAuth provider capability matrix

Status: M1 local-only design/vector evidence, 2026-10-30. This document does
not enable an OAuth provider, create a client, retain a token, or authorize a
live OAuth exchange.

## Exact pin

The package named by the migration documents as `indentify` is published in
Mops as **`identify`** (the extra `n` is a documentation typo). The lockfile,
not a floating registry lookup, is authoritative.

| Item | Pinned value |
| --- | --- |
| Mops package | `identify@0.0.2` |
| Declared source | `https://github.com/f0i/identify` |
| Package manifest SHA-256 | `64319d0b9f91d8e0af1489d2e9d0b7ea2a760778df3df5130d1bda12f6562d18` |
| Full installed package-tree SHA-256 | `5cccbd50f8db28630b937ea8f92212c8e6dc5126c7e8517637467e6c54c6d5f5` |
| Public facade (`src/lib.mo`) SHA-256 | `22fb166b9036d47df24f4ed4e3245415648b802f229789eb4ea19c45eb83a88f` |
| Core implementation (`src/backend/Identify.mo`) SHA-256 | `4cfb9d6546f99a2e84526ca2c1b211324d96534e3d37ec03484f48095f2c72cb` |
| Complete dependency-integrity lock SHA-256 | `9860102747a1e62f6521226de4b5b0329ba0cff58169ea4fcf65857e9ce68970` |
| Package-declared Motoko compiler | `0.16.3` |

The public facade exposes `init`, provider configuration, code-hash locking,
delegation preparation, PKCE/JWT preparation, delegation lookup, and user and
provider queries. M2 must wrap—not expose—those facilities behind the
caller-bound attempt contract. In particular, the library's delegation/session
model is not an application authorization decision.

## Capability matrix

All rows are **disabled until G2**. The approved M1 fixture permits no caller
to select a provider configuration, redirect, client ID, scope, token, code,
or subject. It merely demonstrates fail-closed caller/state/expiry validation.

| Provider | Candidate flow and exact redirect/client binding | Immutable subject | Issuer/audience evidence | Minimum requested scope | Token retention | M1 outcome |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub | PKCE public-client flow only; exact preconfigured certified-frontend callback and client ID | Numeric GitHub user `id` from verified profile | GitHub OAuth profile flow has no OIDC ID-token issuer/audience claim; M2 must bind the configured token endpoint/profile response to the attempt | `read:user`, plus `user:email` only if verified email is required | Discard after subject verification | Disabled pending G2 provider-response proof |
| ORCID | PKCE public-client flow only; exact preconfigured certified-frontend callback and client ID | ORCID iD / OIDC `sub` | Validate configured issuer and client audience when an ID token is used | `/authenticate` | Discard after subject verification | Disabled pending G2 discovery/JWKS/claim proof |
| Bitbucket | PKCE public-client flow only; exact preconfigured certified-frontend callback and client ID | Account UUID (`account_id`) | No assumed OIDC issuer/audience; M2 must prove configured token/profile binding | `account` | Discard after subject verification | Disabled pending G2 provider-response proof |
| GitLab | PKCE public-client flow only; exact preconfigured certified-frontend callback and client ID | Numeric GitLab user `id` (or verified OIDC `sub` if that is the configured flow) | Validate issuer/audience only when the selected flow supplies an ID token | `read_user` (and `openid` only for an approved OIDC flow) | Discard after subject verification | Disabled pending G2 discovery/profile/claim proof |

No confidential-client flow, client secret, live redirect URI, authorization
code, verifier, access token, refresh token, real identity, or provider
credential is present in this repository or fixture. A later confidential flow
requires a separate G2-approved scoped, encrypted, rotatable canister
credential design.

## M1 local vector boundary

`canisters/oauth_attempt_fixture/OAuthAttempt.mo` is intentionally independent
of provider networking and identity binding. Its bounded vector rejects an
anonymous caller, caller swap, expiration, and missing/unsupported provider;
only the original non-anonymous caller plus the original state before expiry is
accepted. The fixture has no public methods and its Candid interface is empty.
