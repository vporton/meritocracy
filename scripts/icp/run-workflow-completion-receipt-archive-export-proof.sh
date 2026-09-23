#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_WORKFLOW_RECEIPT_ARCHIVE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-workflow-receipt-archive-proof}"
"$repo_root/scripts/icp/build-workflow-completion-receipt-archive-export-proof.sh"
for artifact in workflow_receipt_archive_fixture.wasm workflow_receipt_archive_sink.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing workflow archive proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pic_bin="${POCKET_IC_BIN:-$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)}"
[[ -x "$pic_bin" ]] || { echo "PocketIC binary is unavailable: $pic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-workflow-receipt-archive-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
work_bin="$runtime_dir/pocket-ic"
cp -- "$pic_bin" "$work_bin"
chmod 700 "$work_bin"
node "$repo_root/scripts/icp/workflow-completion-receipt-archive-export-pocketic-proof.cjs" "$work_bin" "$artifact_dir/workflow_receipt_archive_fixture.wasm" "$artifact_dir/workflow_receipt_archive_sink.wasm"
echo "Workflow completion-receipt canonical archive EOP proof passed."
