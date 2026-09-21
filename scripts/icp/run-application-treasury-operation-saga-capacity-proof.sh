#!/usr/bin/env bash
# Runs only checksum-verified disposable application/outbox capacity fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_TREASURY_SAGA_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-treasury-operation-saga-proof}"
"$repo_root/scripts/icp/build-application-treasury-operation-saga-proof.sh"
(cd "$artifact_dir" && sha256sum --check SHA256SUMS)
pic_bin="$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)"
[[ -x "$pic_bin" ]] || { echo "Pinned PocketIC binary is unavailable" >&2; exit 1; }
runtime_copy="$(mktemp /tmp/m1-application-treasury-saga-capacity.XXXXXX)"
trap 'rm -f "$runtime_copy"' EXIT
cp "$pic_bin" "$runtime_copy"; chmod 700 "$runtime_copy"
report="$artifact_dir/capacity.json"; rm -f "$report"
node "$repo_root/scripts/icp/application-treasury-operation-saga-capacity-pocketic-proof.cjs" "$runtime_copy" "$artifact_dir/application_treasury_saga_capacity_application.wasm" "$artifact_dir/application_treasury_saga_capacity_treasury.wasm" "$report"
