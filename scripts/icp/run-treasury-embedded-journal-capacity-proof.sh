#!/usr/bin/env bash
# Runs only the checksum-verified synthetic treasury journal capacity proof.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-embedded-journal-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
[[ -f "$artifact_dir/treasury_embedded_journal_proof.wasm" && -f "$artifact_dir/SHA256SUMS" ]] || { echo "Missing treasury journal proof artifact; run its build script first." >&2; exit 1; }
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-journal-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
report="$artifact_dir/capacity.json"
rm -f -- "$report"
node "$repo_root/scripts/icp/treasury-embedded-journal-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/treasury_embedded_journal_proof.wasm" "$report"
echo "Treasury embedded journal capacity PocketIC proof passed."
