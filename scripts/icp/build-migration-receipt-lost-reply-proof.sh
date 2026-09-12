#!/usr/bin/env bash
# Builds only disposable M1 receipt-recovery proof WASMs. It never starts a
# replica or uses DFX, identities, wallets, credentials, or network config.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_MIGRATION_RECEIPT_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-migration-receipt-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"
staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-migration-receipt-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/migration_receipt_authority.wasm" --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$staging_dir/migration_receipt_importer.wasm" --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/fixtures/storage_authority/MigrationReceiptLostReply.mo"
(
  cd "$staging_dir"
  sha256sum migration_receipt_authority.wasm migration_receipt_importer.wasm >SHA256SUMS
)
mv -- "$staging_dir/migration_receipt_authority.wasm" "$artifact_dir/migration_receipt_authority.wasm"
mv -- "$staging_dir/migration_receipt_importer.wasm" "$artifact_dir/migration_receipt_importer.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 migration-receipt lost-reply proof artifacts built in %s\n' "$artifact_dir"
