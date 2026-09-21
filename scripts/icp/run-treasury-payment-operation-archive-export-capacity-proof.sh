#!/usr/bin/env bash
# Runs only checksum-verified disposable archive capacity fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_ARCHIVE_EXPORT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-payment-operation-archive-export-proof}"
"$repo_root/scripts/icp/build-treasury-payment-operation-archive-export-proof.sh"
for artifact in payment_operation_archive_export_capacity_treasury.wasm payment_operation_archive_export_capacity_sink.wasm SHA256SUMS; do [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing archive capacity proof artifact: $artifact" >&2; exit 1; }; done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pic_bin="${POCKET_IC_BIN:-$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)}"
[[ -x "$pic_bin" ]] || { echo "PocketIC binary is unavailable: $pic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-payment-operation-archive-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pic_bin" "$runtime_dir/pocket-ic"; chmod 700 "$runtime_dir/pocket-ic"
report="$artifact_dir/capacity.json"; rm -f -- "$report"
node "$repo_root/scripts/icp/treasury-payment-operation-archive-export-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/payment_operation_archive_export_capacity_treasury.wasm" "$artifact_dir/payment_operation_archive_export_capacity_sink.wasm" "$report"
echo "Treasury payment-operation canonical archive capacity PocketIC proof passed."
