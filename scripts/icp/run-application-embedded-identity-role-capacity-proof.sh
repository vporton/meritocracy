#!/usr/bin/env bash
# Runs only the checksum-verified synthetic private-adapter capacity fixture.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_IDENTITY_ROLE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-embedded-identity-role-proof}"
[[ -f "$artifact_dir/application_embedded_identity_role_proof.wasm" && -f "$artifact_dir/SHA256SUMS" ]] || { echo "Missing application identity/role proof artifact" >&2; exit 1; }
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-application-identity-role-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
rm -f -- "$artifact_dir/capacity.json"
node "$repo_root/scripts/icp/application-embedded-identity-role-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/application_embedded_identity_role_proof.wasm" "$artifact_dir/capacity.json"
echo "Consolidated-application embedded identity/role capacity PocketIC proof passed."
