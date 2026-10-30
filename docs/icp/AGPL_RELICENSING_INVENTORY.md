# AGPL-3.0-only relicensing inventory

Status: completed repository-license evidence accepted at G1 approval on
2026-10-30. This record authorizes no work beyond M1 and makes no legal
determination about third-party dependency licenses.

## Owner authorization

The project owner confirmed on 2026-10-30 that the following commit-author
identities are controlled by the releasor and that their contributions may be
relicensed:

- `Victor Porton <porton.victor@gmail.com>`
- `mathematician <porton.victor@gmail.com>`
- `mathematician Victor Porton <porton.victor@gmail.com>`
- `mathematician Victor Porton <porton@narod.ru>`

The owner also authorized the disposition of repository changes attributed to
`dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>` and
`Fly.io <noreply@fly.io>` for this relicensing. Dependabot changes are
dependency manifest/lockfile updates. The historical Fly.io contribution was
to a deployment configuration; no `fly.toml` is present in the tracked
release tree. This record does not assert that either service's own software
is relicensed.

`git log --format='%aN <%aE>' | sort -u` was the repository-author inventory
method. It produced the six identities above; no other author identity was
found in reachable history as of this record.

## License and notice disposition

| Artifact | Before | Disposition |
| --- | --- | --- |
| `LICENSE.txt` | Apache-2.0 text | Replaced with the canonical GNU AGPL v3 text; current repository license is `AGPL-3.0-only`. |
| `LICENSE2.txt` | MIT text, `Copyright 2025 Victor Porton` | Preserved verbatim as `licenses/MIT-historical.txt`. |
| former `LICENSE.txt` | Apache-2.0 text | Preserved verbatim as `licenses/Apache-2.0-historical.txt`. |
| `NOTICE` | absent | Added to identify the current license, historical texts, and dependency-license boundary. |
| root/backend/frontend manifests | MIT or absent license metadata | Set to SPDX `AGPL-3.0-only`. |
| root/backend/frontend lockfiles | root workspace metadata reflected prior/absent license | Updated only for the owned workspace-package license metadata; transitive dependency license fields are retained unchanged. |
| `README.md` | stated MIT | States AGPL-3.0-only and links to the notice. |

Review hashes:

| File | SHA-256 |
| --- | --- |
| `LICENSE.txt` | `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0` |
| `licenses/Apache-2.0-historical.txt` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `licenses/MIT-historical.txt` | `a1fc4ff766732b308350aaa24ffb43112381d7eb90a752533604ec36a187059f` |

## Distribution and third-party boundary

The tracked repository contains no built distributable archive, `dist/`,
`build/`, `coverage/`, `node_modules/`, or Wasm artifact. It does contain
source, deployment configuration, and npm lockfiles. Future source and
network-service distributions must provide the corresponding source and
prominent AGPL-3.0 notice as required by the license; a future artifact review
must also retain the license notices of bundled third-party material.

Dependency lockfiles describe external packages and their individual license
metadata. This change neither rewrites those metadata fields nor purports to
relicense dependencies. A later dependency/SBOM review remains required by
the G1/G2 plan.

## Validation record

The relicensing change is validated by checking the canonical AGPL title in
`LICENSE.txt`, the SPDX metadata in all workspace manifests and workspace
lockfile entries, the historical-text hashes recorded by the review command,
and `git diff --check`.

## G1 approval record

This inventory resolved the contributor/licensor authority item identified by
the owner. On 2026-10-30 the owner also approved the complete target
architecture recorded in `ARCHITECTURE.md`, including private in-process
storage. The gate status is recorded in `PLANS.md`. G1 approval permits M1
only; G2--G4 and every production action remain unapproved.
