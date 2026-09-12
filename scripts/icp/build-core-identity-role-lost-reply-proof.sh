#!/usr/bin/env bash
# Builds the exact M1 storage-authority artifact plus a disposable synthetic
# core fixture. It never starts a replica or reads DFX state, identities,
# wallets, or a network.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_CORE_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-core-identity-role-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"

artifact_parent="$(dirname "$artifact_dir")"
staging_dir="$(mktemp -d "$artifact_parent/.m1-core-lost-reply-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/core_lost_reply_authority.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$staging_dir/core_lost_reply_core.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/CoreIdentityRoleLostReplyCore.mo"
"$moc_path" -o="$staging_dir/core_lost_reply_archive.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/IdentityRoleArchiveSink.mo"
(
  cd "$staging_dir"
  sha256sum core_lost_reply_authority.wasm core_lost_reply_core.wasm core_lost_reply_archive.wasm >SHA256SUMS
)
mv -- "$staging_dir/core_lost_reply_authority.wasm" "$artifact_dir/core_lost_reply_authority.wasm"
mv -- "$staging_dir/core_lost_reply_core.wasm" "$artifact_dir/core_lost_reply_core.wasm"
mv -- "$staging_dir/core_lost_reply_archive.wasm" "$artifact_dir/core_lost_reply_archive.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 core lost-reply proof artifacts built in %s\n' "$artifact_dir"
