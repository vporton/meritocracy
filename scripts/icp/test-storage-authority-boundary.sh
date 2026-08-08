#!/usr/bin/env bash
# Runs the M1 storage-authority boundary proof on pinned PocketIC.
#
# This never invokes DFX, reads an identity, accepts a wallet, or targets a
# network. PocketIC receives only synthetic principals and creates its own
# disposable instance. The compiled Wasm files and PocketIC state live in a
# fresh /tmp directory and are removed at exit.
set -euo pipefail

readonly expected_mops_version="CLI 2.19.2"
readonly expected_moc_version="Motoko compiler 1.4.1"
readonly expected_pocket_ic_version="12.0.0"
readonly expected_pic_js_version="0.14.8"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
workdir="$(mktemp -d /tmp/meritocracy-storage-authority-pocketic.XXXXXXXX)"
cd "$repo_root"

cleanup() {
  rm -rf -- "$workdir"
}
trap cleanup EXIT

for command in node; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

[[ "$("${mops_cli[@]}" --version | head -n 1)" == "$expected_mops_version" ]] || {
  echo "Expected Mops $expected_mops_version; found: $("${mops_cli[@]}" --version | head -n 1)" >&2
  exit 1
}
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || {
  echo "Pinned Mops moc is unavailable: $moc_path" >&2
  exit 1
}
[[ "$("$moc_path" --version | head -n 1)" == "$expected_moc_version"* ]] || {
  echo "Expected moc $expected_moc_version; found: $("$moc_path" --version | head -n 1)" >&2
  exit 1
}
grep -Fq "pocket-ic = \"$expected_pocket_ic_version\"" "$repo_root/mops.toml" || {
  echo "Mops must pin pocket-ic $expected_pocket_ic_version" >&2
  exit 1
}
[[ "$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$repo_root/node_modules/ic-mops/node_modules/pic-js-mops/package.json")" == "$expected_pic_js_version" ]] || {
  echo "Expected Mops-bundled pic-js-mops $expected_pic_js_version" >&2
  exit 1
}

pocket_ic_bin="$("${mops_cli[@]}" toolchain bin pocket-ic)"
[[ -x "$pocket_ic_bin" ]] || {
  echo "Pinned PocketIC binary is unavailable: $pocket_ic_bin" >&2
  exit 1
}

mops_source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  mops_source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$workdir/storage_authority.wasm" \
  --enhanced-orthogonal-persistence \
  "${mops_source_args[@]}" \
  "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$workdir/storage_authority_caller.wasm" \
  --enhanced-orthogonal-persistence \
  "${mops_source_args[@]}" \
  "$repo_root/fixtures/storage_authority/StorageAuthorityCaller.mo"

node "$repo_root/scripts/icp/storage-authority-pocketic-proof.cjs" \
  "$pocket_ic_bin" \
  "$workdir/storage_authority.wasm" \
  "$workdir/storage_authority_caller.wasm"

echo "Storage-authority identity-free PocketIC boundary proof passed."
