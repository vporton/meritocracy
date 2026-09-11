#!/usr/bin/env bash
# Builds the disposable M1 embedded identity/role adapter fixture. It neither
# starts a replica nor reads DFX configuration, identities, wallets, or a network.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_IDENTITY_ROLE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-embedded-identity-role-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")

moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$artifact_dir/embedded_identity_role_proof.wasm" \
  --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/EmbeddedIdentityRoleStoreProof.mo"
sha256sum "$artifact_dir/embedded_identity_role_proof.wasm" >"$artifact_dir/SHA256SUMS"
printf 'M1 embedded identity/role proof artifact built in %s\n' "$artifact_dir"
