#!/usr/bin/env bash
# Runs only a disposable synthetic PocketIC treasury-journal recovery proof.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-journal-lost-reply-proof}"
for artifact in treasury_journal_authority.wasm treasury_journal_fixture.wasm treasury_journal_archive.wasm SHA256SUMS; do [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing treasury-journal proof artifact: $artifact" >&2; exit 1; }; done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"; [[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-journal-pocketic.XXXXXX")"; trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"; chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/treasury-journal-lost-reply-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/treasury_journal_authority.wasm" "$artifact_dir/treasury_journal_fixture.wasm" "$artifact_dir/treasury_journal_archive.wasm"
echo "Treasury-journal lost-reply PocketIC proof passed."
