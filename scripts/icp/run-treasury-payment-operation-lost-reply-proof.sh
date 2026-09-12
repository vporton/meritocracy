#!/usr/bin/env bash
# Executes only the synthetic M1 treasury-to-authority lost-reply proof.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-payment-operation-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
for artifact in treasury_lost_reply_authority.wasm treasury_lost_reply_treasury.wasm treasury_lost_reply_archive.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing treasury lost-reply proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }

# pic-js-mops chmods its supplied binary. Use only a disposable byte-for-byte
# copy so the Mops cache remains read-only and no DFX identity is consulted.
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-lost-reply-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
runtime_bin="$runtime_dir/pocket-ic"
cp -- "$pocket_ic_bin" "$runtime_bin"
chmod 700 "$runtime_bin"
node "$repo_root/scripts/icp/treasury-payment-operation-lost-reply-pocketic-proof.cjs" "$runtime_bin" "$artifact_dir/treasury_lost_reply_authority.wasm" "$artifact_dir/treasury_lost_reply_treasury.wasm" "$artifact_dir/treasury_lost_reply_archive.wasm"
echo "Treasury payment-operation lost-reply PocketIC proof passed."
