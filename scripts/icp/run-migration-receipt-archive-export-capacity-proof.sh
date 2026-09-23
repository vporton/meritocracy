#!/usr/bin/env bash
# Runs only checksum-verified disposable migration archive capacity fixtures.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_MIGRATION_RECEIPT_ARCHIVE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-migration-receipt-archive-proof}"
"$repo_root/scripts/icp/build-migration-receipt-archive-export-proof.sh"
for artifact in migration_receipt_archive_capacity_fixture.wasm migration_receipt_archive_capacity_sink.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing migration archive capacity proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pic_bin="${POCKET_IC_BIN:-$(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js" toolchain bin pocket-ic)}"
[[ -x "$pic_bin" ]] || { echo "PocketIC binary is unavailable: $pic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-migration-receipt-archive-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pic_bin" "$runtime_dir/pocket-ic"; chmod 700 "$runtime_dir/pocket-ic"
report="$artifact_dir/capacity.json"; rm -f -- "$report"
node "$repo_root/scripts/icp/migration-receipt-archive-export-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/migration_receipt_archive_capacity_fixture.wasm" "$artifact_dir/migration_receipt_archive_capacity_sink.wasm" "$report"
echo "Migration-receipt canonical archive capacity PocketIC proof passed."
