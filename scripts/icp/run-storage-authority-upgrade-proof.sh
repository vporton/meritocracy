#!/usr/bin/env bash
# Runs only the M1 real PocketIC storage-authority upgrade proof. Build first
# with build-storage-authority-upgrade-proof.sh to keep replica runtime separate.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_UPGRADE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-storage-authority-upgrade-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")

for artifact in storage_authority_pre_embedded.wasm storage_authority_embedded.wasm storage_authority_caller.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing $artifact_dir/$artifact; run scripts/icp/build-storage-authority-upgrade-proof.sh first." >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)

pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin. Set POCKET_IC_BIN to the pinned PocketIC 12.0.0 executable." >&2; exit 1; }

node "$repo_root/scripts/icp/storage-authority-pocketic-proof.cjs" \
  "$pocket_ic_bin" \
  "$artifact_dir/storage_authority_pre_embedded.wasm" \
  "$artifact_dir/storage_authority_embedded.wasm" \
  "$artifact_dir/storage_authority_caller.wasm"

echo "Storage-authority real PocketIC upgrade proof passed."
