#!/usr/bin/env bash
# Builds only disposable synthetic canonical-archive-export proof Wasms. It
# starts no replica and reads no DFX configuration, identity, wallet, or network state.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_ARCHIVE_EXPORT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-journal-archive-export-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"

staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-treasury-journal-archive-export-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
source_args=()
while IFS= read -r source_line; do
  read -r -a source_line_args <<< "$source_line"
  source_args+=("${source_line_args[@]}")
done < <("${mops_cli[@]}" sources --no-install)

"$moc_path" -o="$staging_dir/treasury_journal_archive_export_fixture.wasm" \
  --release --enhanced-orthogonal-persistence "${source_args[@]}" \
  "$repo_root/fixtures/treasury/TreasuryJournalArchiveExportLostReply.mo"
"$moc_path" -o="$staging_dir/treasury_journal_archive_export_sink.wasm" \
  --release --enhanced-orthogonal-persistence "${source_args[@]}" \
  "$repo_root/fixtures/treasury/TreasuryJournalArchiveExportSink.mo"
(
  cd "$staging_dir"
  sha256sum treasury_journal_archive_export_fixture.wasm treasury_journal_archive_export_sink.wasm > SHA256SUMS
)
mv -- "$staging_dir/treasury_journal_archive_export_fixture.wasm" "$artifact_dir/treasury_journal_archive_export_fixture.wasm"
mv -- "$staging_dir/treasury_journal_archive_export_sink.wasm" "$artifact_dir/treasury_journal_archive_export_sink.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 treasury-journal canonical archive-export proof artifacts built in %s\n' "$artifact_dir"
