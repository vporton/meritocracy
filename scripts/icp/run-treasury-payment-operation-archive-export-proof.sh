#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_ARCHIVE_EXPORT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-payment-operation-archive-export-proof}"
"$repo_root/scripts/icp/build-treasury-payment-operation-archive-export-proof.sh"
for artifact in payment_operation_archive_export_treasury.wasm payment_operation_archive_export_sink.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing archive export proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pic_bin="${POCKET_IC_BIN:-$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)}"
[[ -x "$pic_bin" ]] || { echo "PocketIC binary is unavailable: $pic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-payment-operation-archive-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
work_bin="$runtime_dir/pocket-ic"
cp -- "$pic_bin" "$work_bin"
chmod 700 "$work_bin"
node "$repo_root/scripts/icp/treasury-payment-operation-archive-export-pocketic-proof.cjs" "$work_bin" "$artifact_dir/payment_operation_archive_export_treasury.wasm" "$artifact_dir/payment_operation_archive_export_sink.wasm"
echo "Treasury payment-operation canonical archive PocketIC proof passed."
