#!/usr/bin/env bash
# Runs only the checksum-verified synthetic application-adapter fixture.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_WORKFLOW_RECEIPT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-embedded-workflow-receipt-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
[[ -f "$artifact_dir/application_embedded_workflow_receipt_proof.wasm" && -f "$artifact_dir/SHA256SUMS" ]] || {
  echo "Missing application workflow receipt proof artifact; run scripts/icp/build-application-embedded-workflow-receipt-proof.sh first." >&2
  exit 1
}
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-application-workflow-receipt-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/embedded-workflow-receipt-pocketic-proof.cjs" \
  "$runtime_dir/pocket-ic" "$artifact_dir/application_embedded_workflow_receipt_proof.wasm"
echo "Consolidated-application embedded workflow receipt PocketIC proof passed."
