#!/usr/bin/env bash
# Builds only the disposable treasury private-journal proof fixture.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_JOURNAL_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-embedded-journal-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"
staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-treasury-journal-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
source_args=()
while IFS= read -r source_line; do read -r -a source_line_args <<< "$source_line"; source_args+=("${source_line_args[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$staging_dir/treasury_embedded_journal_proof.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/treasury/EmbeddedTreasuryJournalStoreProof.mo"
( cd "$staging_dir" && sha256sum treasury_embedded_journal_proof.wasm > SHA256SUMS )
mv -- "$staging_dir/treasury_embedded_journal_proof.wasm" "$artifact_dir/treasury_embedded_journal_proof.wasm"
mv -- "$staging_dir/SHA256SUMS" "$artifact_dir/SHA256SUMS"
printf 'M1 treasury embedded journal proof artifact built in %s\n' "$artifact_dir"
