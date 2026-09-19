#!/usr/bin/env bash
# Runs only checksum-verified, synthetic PocketIC canonical archive-export proof.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_ARCHIVE_EXPORT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-journal-archive-export-proof}"
for artifact in treasury_journal_archive_export_fixture.wasm treasury_journal_archive_export_sink.wasm SHA256SUMS; do
  [[ -f "$artifact_dir/$artifact" ]] || { echo "Missing canonical archive-export proof artifact: $artifact" >&2; exit 1; }
done
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }

runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-journal-archive-export-pocketic.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
node "$repo_root/scripts/icp/treasury-journal-archive-export-pocketic-proof.cjs" \
  "$runtime_dir/pocket-ic" \
  "$artifact_dir/treasury_journal_archive_export_fixture.wasm" \
  "$artifact_dir/treasury_journal_archive_export_sink.wasm"
echo "Treasury-journal canonical archive-export PocketIC proof passed."
