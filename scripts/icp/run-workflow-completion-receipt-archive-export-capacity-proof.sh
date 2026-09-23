#!/usr/bin/env bash
# Runs only checksum-verified disposable workflow archive capacity fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_WORKFLOW_RECEIPT_ARCHIVE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-workflow-receipt-archive-proof}"
"$repo_root/scripts/icp/build-workflow-completion-receipt-archive-export-proof.sh"
for artifact in workflow_receipt_archive_capacity_fixture.wasm workflow_receipt_archive_capacity_sink.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing workflow archive capacity proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pic_bin="${POCKET_IC_BIN:-$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)}"
[[ -x "$pic_bin" ]] || { echo "PocketIC binary is unavailable: $pic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-workflow-receipt-archive-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pic_bin" "$runtime_dir/pocket-ic"; chmod 700 "$runtime_dir/pocket-ic"
report="$artifact_dir/capacity.json"; rm -f -- "$report"
node "$repo_root/scripts/icp/workflow-completion-receipt-archive-export-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/workflow_receipt_archive_capacity_fixture.wasm" "$artifact_dir/workflow_receipt_archive_capacity_sink.wasm" "$report"
echo "Workflow completion-receipt canonical archive capacity PocketIC proof passed."
