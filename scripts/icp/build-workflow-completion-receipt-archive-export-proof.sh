#!/usr/bin/env bash
# Builds only disposable canonical workflow-receipt archive proof Wasms.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_WORKFLOW_RECEIPT_ARCHIVE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-workflow-receipt-archive-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable" >&2; exit 1; }
mkdir -p "$artifact_dir"
source_args=()
while IFS= read -r line; do read -r -a args <<< "$line"; source_args+=("${args[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$artifact_dir/workflow_receipt_archive_fixture.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/WorkflowCompletionReceiptArchiveExportLostReply.mo"
"$moc_path" -o="$artifact_dir/workflow_receipt_archive_sink.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/WorkflowCompletionReceiptArchiveExportSink.mo"
"$moc_path" -o="$artifact_dir/workflow_receipt_archive_capacity_fixture.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/WorkflowCompletionReceiptArchiveExportCapacityFixture.mo"
"$moc_path" -o="$artifact_dir/workflow_receipt_archive_capacity_sink.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/WorkflowCompletionReceiptArchiveExportCapacitySink.mo"
(cd "$artifact_dir" && sha256sum workflow_receipt_archive_fixture.wasm workflow_receipt_archive_sink.wasm workflow_receipt_archive_capacity_fixture.wasm workflow_receipt_archive_capacity_sink.wasm > SHA256SUMS)
