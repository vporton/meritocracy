#!/usr/bin/env bash
# Runs only a disposable PocketIC capacity boundary for treasury_journal_v1.
# It does not use DFX, a wallet, identity, network, balances, or target data.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-journal-lost-reply-proof}"
for artifact in treasury_journal_authority.wasm treasury_journal_fixture.wasm treasury_journal_archive.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing treasury-journal capacity proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-journal-capacity-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/treasury-journal-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/treasury_journal_authority.wasm" "$artifact_dir/treasury_journal_fixture.wasm" "$artifact_dir/capacity.json"
echo "Treasury-journal capacity PocketIC proof passed."
