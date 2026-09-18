#!/usr/bin/env bash
# Builds disposable synthetic proof Wasms only; it never starts a replica.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_LOST_REPLY_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-journal-lost-reply-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"
staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-treasury-journal-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
mops_source_args=()
while IFS= read -r source_line; do read -r -a source_line_args <<< "$source_line"; mops_source_args+=("${source_line_args[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$staging_dir/treasury_journal_authority.wasm" --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$staging_dir/treasury_journal_fixture.wasm" --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/fixtures/storage_authority/TreasuryJournalLostReply.mo"
"$moc_path" -o="$staging_dir/treasury_journal_archive.wasm" --release --enhanced-orthogonal-persistence "${mops_source_args[@]}" "$repo_root/fixtures/storage_authority/TreasuryJournalArchiveSink.mo"
( cd "$staging_dir" && sha256sum treasury_journal_authority.wasm treasury_journal_fixture.wasm treasury_journal_archive.wasm >SHA256SUMS )
mv -- "$staging_dir/treasury_journal_authority.wasm" "$artifact_dir/treasury_journal_authority.wasm"
mv -- "$staging_dir/treasury_journal_fixture.wasm" "$artifact_dir/treasury_journal_fixture.wasm"
mv -- "$staging_dir/treasury_journal_archive.wasm" "$artifact_dir/treasury_journal_archive.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
echo "M1 treasury-journal lost-reply proof artifacts built in $artifact_dir"
