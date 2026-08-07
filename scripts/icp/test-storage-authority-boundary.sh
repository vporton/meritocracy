#!/usr/bin/env bash
# This proof is deliberately disabled until it is ported to PocketIC.
#
# DFX 0.32 identities are global rather than project-scoped. The former DFX
# runner could therefore select or import a developer identity even though it
# targeted a disposable local replica. That violates the M1 requirement that
# development and CI be cryptographically unable to use production signing
# authority. Do not replace this guard with an ambient DFX identity. The
# replacement must use a pinned PocketIC harness with synthetic principals.
set -euo pipefail

echo "Storage-authority local-boundary proof is blocked pending its identity-free PocketIC replacement." >&2
exit 2
