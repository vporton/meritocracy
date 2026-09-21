#!/usr/bin/env bash
# Runs only the checksum-verified synthetic treasury private-adapter capacity proof.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="${M1_TREASURY_PAYMENT_OPERATION_PROOF_ARTIFACT_DIR:-$repo_root/.mops/m1-treasury-embedded-payment-operation-proof}"
mops_cli=(node "$repo_root/node_modules/ic-mops/dist/bin/mops.js")
[[ -f "$artifact_dir/treasury_embedded_payment_operation_proof.wasm" && -f "$artifact_dir/SHA256SUMS" ]] || { echo "Missing treasury payment-operation proof artifact; run its build script first." >&2; exit 1; }
(cd "$artifact_dir" && sha256sum -c SHA256SUMS)
pocket_ic_bin="${POCKET_IC_BIN:-$("${mops_cli[@]}" toolchain bin pocket-ic)}"
[[ -x "$pocket_ic_bin" ]] || { echo "PocketIC binary is unavailable: $pocket_ic_bin" >&2; exit 1; }
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/m1-treasury-embedded-capacity.XXXXXX")"
trap 'rm -rf -- "$runtime_dir"' EXIT
cp -- "$pocket_ic_bin" "$runtime_dir/pocket-ic"
chmod 700 "$runtime_dir/pocket-ic"
report="$artifact_dir/capacity.json"
rm -f -- "$report"
node "$repo_root/scripts/icp/treasury-embedded-payment-operation-capacity-pocketic-proof.cjs" "$runtime_dir/pocket-ic" "$artifact_dir/treasury_embedded_payment_operation_proof.wasm" "$report"
echo "Treasury embedded payment-operation capacity PocketIC proof passed."
