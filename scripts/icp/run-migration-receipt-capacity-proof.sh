#!/usr/bin/env bash
# Runs only a disposable PocketIC capacity boundary for the fixed migration
# receipt adapter. It does not use DFX, PostgreSQL, credentials, or target data.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_MIGRATION_RECEIPT_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-migration-receipt-lost-reply-proof}"
for artifact in migration_receipt_authority.wasm migration_receipt_importer.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing migration-receipt capacity proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-migration-capacity-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/migration-receipt-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/migration_receipt_authority.wasm" "$artifact_dir/migration_receipt_importer.wasm" "$artifact_dir/capacity.json"
echo "Migration-receipt capacity PocketIC proof passed."
