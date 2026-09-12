#!/usr/bin/env bash
# Runs the synthetic M1 importer-to-authority lost-reply proof only.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_MIGRATION_RECEIPT_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-migration-receipt-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
for artifact in migration_receipt_authority.wasm migration_receipt_importer.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing migration-receipt proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-migration-receipt-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
runtime_bin="$runtime_dir/pocket-ic"
cp -- "$pocket_ic_bin" "$runtime_bin"
chmod 700 "$runtime_bin"
node "$repo_root/scripts/icp/migration-receipt-lost-reply-pocketic-proof.cjs" "$runtime_bin" "$artifact_dir/migration_receipt_authority.wasm" "$artifact_dir/migration_receipt_importer.wasm"
echo "Migration-receipt lost-reply PocketIC proof passed."
