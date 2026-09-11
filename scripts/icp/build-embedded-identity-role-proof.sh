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

# Compile and hash in a sibling disposable directory, then publish only a
# complete pair.  The linked ZenDB fixture can take longer than an interactive
# command allowance; an interrupted compiler must not leave a new Wasm behind
# with an old checksum and tempt a later runner to treat it as evidence.
artifact_parent="$(dirname "$artifact_dir")"
staging_dir="$(mktemp -d "$artifact_parent/.m1-embedded-identity-role-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/embedded_identity_role_proof.wasm" \
  --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/EmbeddedIdentityRoleStoreProof.mo"

# The linked fixture is installed by the runner through the IC chunked-Wasm
# management API. The runner bounds every individual upload below PocketIC's
# 2 MiB ingress maximum; this build intentionally does not reject a valid
# multi-chunk module.
# Keep the published manifest relative to its artifact directory.  A checksum
# containing the disposable staging path would correctly fail after the pair
# is atomically published, but would make every later proof unusable.
(
  cd "$staging_dir"
  sha256sum embedded_identity_role_proof.wasm >SHA256SUMS
)

# Publish the checksum last. A runner observing the narrow replacement window
# fails closed against the old checksum rather than executing an unverified
# Wasm; a killed build never reaches either replacement.
mv -- "$staging_dir/embedded_identity_role_proof.wasm" "$artifact_dir/embedded_identity_role_proof.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 embedded identity/role proof artifact built in %s\n' "$artifact_dir"
