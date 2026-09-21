#!/usr/bin/env bash
# Builds only disposable M1 archive-binding proof Wasms; no DFX identity,
# wallet, network configuration, target data, or deployment is consulted.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_ARCHIVE_EXPORT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-payment-operation-archive-export-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"
source_args=()
while IFS= read -r line; do read -r -a args <<< "$line"; source_args+=("${args[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$artifact_dir/payment_operation_archive_export_treasury.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/treasury/PaymentOperationArchiveExportLostReply.mo"
"$moc_path" -o="$artifact_dir/payment_operation_archive_export_sink.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/treasury/PaymentOperationArchiveExportSink.mo"
"$moc_path" -o="$artifact_dir/payment_operation_archive_export_capacity_treasury.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/treasury/PaymentOperationArchiveExportCapacityTreasury.mo"
"$moc_path" -o="$artifact_dir/payment_operation_archive_export_capacity_sink.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/treasury/PaymentOperationArchiveExportCapacitySink.mo"
(cd "$artifact_dir" && sha256sum payment_operation_archive_export_treasury.wasm payment_operation_archive_export_sink.wasm payment_operation_archive_export_capacity_treasury.wasm payment_operation_archive_export_capacity_sink.wasm > SHA256SUMS)
