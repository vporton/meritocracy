#!/usr/bin/env bash
# Builds only disposable application/treasury saga proof Wasms.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_APPLICATION_TREASURY_SAGA_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-application-treasury-operation-saga-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
moc_path="$("${mops_cli[@]}" toolchain bin moc)"
[[ -x "$moc_path" ]] || { echo "Pinned Mops moc is unavailable: $moc_path" >&2; exit 1; }
mkdir -p "$artifact_dir"
source_args=()
while IFS= read -r line; do read -r -a args <<< "$line"; source_args+=("${args[@]}"); done < <("${mops_cli[@]}" sources --no-install)
"$moc_path" -o="$artifact_dir/application_treasury_saga.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/TreasuryOperationSagaLostReply.mo"
"$moc_path" -o="$artifact_dir/application_treasury_sink.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/TreasuryOperationSagaSink.mo"
"$moc_path" -o="$artifact_dir/application_treasury_saga_capacity_application.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/TreasuryOperationSagaCapacityApplication.mo"
"$moc_path" -o="$artifact_dir/application_treasury_saga_capacity_treasury.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/TreasuryOperationSagaCapacityTreasury.mo"
"$moc_path" -o="$artifact_dir/application_treasury_saga_low_cycle.wasm" --release --enhanced-orthogonal-persistence "${source_args[@]}" "$repo_root/fixtures/application/TreasuryOperationSagaLowCycle.mo"
(cd "$artifact_dir" && sha256sum application_treasury_saga.wasm application_treasury_sink.wasm application_treasury_saga_capacity_application.wasm application_treasury_saga_capacity_treasury.wasm application_treasury_saga_low_cycle.wasm > SHA256SUMS)
