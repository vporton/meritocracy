#!/usr/bin/env bash
# Runs only the checksum-verified disposable low-cycle saga fixture.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_TREASURY_SAGA_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-treasury-operation-saga-proof}"
"$repo_root/scripts/icp/build-application-treasury-operation-saga-proof.sh"
(cd "$artifact_dir" && sha256sum --check SHA256SUMS)
pocket_ic_bin="$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)"
[[ -x "$pocket_ic_bin" ]] || { echo "Pinned PocketIC binary is unavailable" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-application-treasury-saga-low-cycle.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/application-treasury-operation-saga-low-cycle-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/application_treasury_saga_low_cycle.wasm" "$artifact_dir/application_treasury_sink.wasm"
echo "Application treasury operation saga low-cycle PocketIC proof passed."
