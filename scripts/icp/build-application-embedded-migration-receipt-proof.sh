#!/usr/bin/env bash
# Builds only the disposable consolidated-application migration-receipt proof
# fixture. It starts no replica and reads no DFX configuration, identity,
# wallet, database, source data, or network state.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_MIGRATION_RECEIPT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-embedded-migration-receipt-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"

staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-application-migration-receipt-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/application_embedded_migration_receipt_proof.wasm" \
  --release --enhanced-orthogonal-persistence "${source_args[@]}" \
  "$repo_root/fixtures/application/EmbeddedMigrationReceiptStoreProof.mo"
(
  cd "$staging_dir"
  sha256sum application_embedded_migration_receipt_proof.wasm > SHA256SUMS
)
mv -- "$staging_dir/application_embedded_migration_receipt_proof.wasm" "$artifact_dir/application_embedded_migration_receipt_proof.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 consolidated-application migration receipt proof artifact built in %s\n' "$artifact_dir"
