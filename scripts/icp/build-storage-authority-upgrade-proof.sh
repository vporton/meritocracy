#!/usr/bin/env bash
# Builds only the three Wasm artifacts consumed by the M1 PocketIC upgrade
# proof. It performs no replica start and never contacts a network or wallet.
set -euo pipefail

readonly pre_embedded_commit="4b9e51377ca351b4a162c5d102b258536d539ba2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_UPGRADE_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-storage-authority-upgrade-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")

command -v node >/dev/null || { echo "Missing required command: node" >&2; exit 1; }
git -C "$repo_root" cat-file -e "${pre_embedded_commit}:canisters/storage_authority/main.mo" || {
  echo "Missing pinned pre-embedded storage-authority commit ${pre_embedded_commit}; fetch repository history before building this proof." >&2
  exit 1
}

moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }

mkdir -p "$artifact_dir"
# Motoko resolves the historical actor's local imports relative to its source
# path. Recreate only that tiny source layout under the artifact directory;
# do not check out or build another workspace revision.
pre_embedded_root="$artifact_dir/pre_embedded_source"
pre_embedded_source="$pre_embedded_root/canisters/storage_authority/main.mo"
mkdir -p "$pre_embedded_root/canisters/storage_authority" "$pre_embedded_root/canisters/shared"
git -C "$repo_root" show "${pre_embedded_commit}:canisters/storage_authority/main.mo" >"$pre_embedded_source"
cp "$repo_root/canisters/storage_authority/StorageAuthorityPolicy.mo" "$pre_embedded_root/canisters/storage_authority/StorageAuthorityPolicy.mo"
cp "$repo_root/canisters/shared/StorageCatalog.mo" "$pre_embedded_root/canisters/shared/StorageCatalog.mo"

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$artifact_dir/storage_authority_pre_embedded.wasm" \
  --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$pre_embedded_source"
"$moc_path" -o="$artifact_dir/storage_authority_embedded.wasm" \
  --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$artifact_dir/storage_authority_caller.wasm" \
  --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/fixtures/storage_authority/StorageAuthorityCaller.mo"

sha256sum "$artifact_dir"/*.wasm >"$artifact_dir/SHA256SUMS"
printf 'M1 PocketIC upgrade-proof artifacts built in %s\n' "$artifact_dir"
