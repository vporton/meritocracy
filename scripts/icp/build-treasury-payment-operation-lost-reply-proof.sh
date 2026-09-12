#!/usr/bin/env bash
# Builds only disposable M1 proof WASMs. It does not start a replica or read
# DFX state, identities, wallets, credentials, or network configuration.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-payment-operation-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"

artifact_parent="$(dirname "$artifact_dir")"
staging_dir="$(mktemp -d "$artifact_parent/.m1-treasury-lost-reply-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/treasury_lost_reply_treasury.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/TreasuryPaymentOperationLostReply.mo"
"$moc_path" -o="$staging_dir/treasury_lost_reply_authority.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$staging_dir/treasury_lost_reply_archive.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/PaymentOperationArchiveSink.mo"
"$moc_path" -o="$staging_dir/treasury_lost_reply_transfer.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/PaymentOperationTransferSink.mo"
(
  cd "$staging_dir"
  sha256sum treasury_lost_reply_authority.wasm treasury_lost_reply_treasury.wasm treasury_lost_reply_archive.wasm treasury_lost_reply_transfer.wasm >SHA256SUMS
)
mv -- "$staging_dir/treasury_lost_reply_authority.wasm" "$artifact_dir/treasury_lost_reply_authority.wasm"
mv -- "$staging_dir/treasury_lost_reply_treasury.wasm" "$artifact_dir/treasury_lost_reply_treasury.wasm"
mv -- "$staging_dir/treasury_lost_reply_archive.wasm" "$artifact_dir/treasury_lost_reply_archive.wasm"
mv -- "$staging_dir/treasury_lost_reply_transfer.wasm" "$artifact_dir/treasury_lost_reply_transfer.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 treasury lost-reply proof artifacts built in %s\n' "$artifact_dir"
