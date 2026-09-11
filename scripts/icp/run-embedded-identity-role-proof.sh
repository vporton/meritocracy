#!/usr/bin/env bash
# Executes only the synthetic M1 adapter fixture on pinned PocketIC.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_IDENTITY_ROLE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-embedded-identity-role-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")

[[ -f "$artifact_dir/embedded_identity_role_proof.wasm" && -f "$artifact_dir/SHA256SUMS" ]] || {
  echo "Missing identity/role proof artifact; run scripts/icp/build-embedded-identity-role-proof.sh first." >&2; exit 1;
}
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
node "$repo_root/scripts/icp/embedded-identity-role-pocketic-proof.cjs" "$pocket_ic_bin" "$artifact_dir/embedded_identity_role_proof.wasm"
echo "Embedded identity/role PocketIC proof passed."
