#!/usr/bin/env bash
# Compatibility entry point for the M1 PocketIC boundary proof. Artifact
# construction is intentionally separate; see build-storage-authority-upgrade-proof.sh.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$repo_root/scripts/icp/run-storage-authority-upgrade-proof.sh"
