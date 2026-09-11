#!/usr/bin/env bash
# Executes only the synthetic M1 core-to-authority lost-reply proof.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_CORE_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-core-identity-role-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
for artifact in core_lost_reply_authority.wasm core_lost_reply_core.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing lost-reply proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-core-lost-reply-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
runtime_bin="$runtime_dir/pocket-ic"
cp -- "$pocket_ic_bin" "$runtime_bin"
chmod 700 "$runtime_bin"
node "$repo_root/scripts/icp/core-identity-role-lost-reply-pocketic-proof.cjs" "$runtime_bin" "$artifact_dir/core_lost_reply_authority.wasm" "$artifact_dir/core_lost_reply_core.wasm"
echo "Core identity/role lost-reply and authority-upgrade PocketIC proof passed."
