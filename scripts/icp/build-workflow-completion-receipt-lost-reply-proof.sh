#!/usr/bin/env bash
# Builds only disposable workflow/authority proof Wasms; it starts no network.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_WORKFLOW_COMPLETION_RECEIPT_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-workflow-completion-receipt-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable" >&2; exit 1; }
mkdir -p "$artifact_dir"
staging_dir="$(mktemp -d "$(dirname "$artifact_dir")/.m1-workflow-receipt-build.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
source_args=()
while IFS= read -r line; do read -r -a words <<< "$line"; source_args+=("${words[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$staging_dir/authority.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/canisters/storage_authority/main.mo"
"$moc_path" -o="$staging_dir/workflow.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/storage_authority/WorkflowCompletionReceiptLostReply.mo"
(cd "$staging_dir" && sha256sum authority.wasm workflow.wasm > SHA256SUMS)
mv "$staging_dir/authority.wasm" "$staging_dir/workflow.wasm" "$staging_dir/SHA256SUMS" "$artifact_dir/"
echo "M1 workflow completion-receipt proof artifacts built in $artifact_dir"
