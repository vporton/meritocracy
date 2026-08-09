#!/usr/bin/env bash
# Reproduces the M1 ZenDB candidate artifacts in an isolated local checkout.
# It never deploys to a non-local network and rejects any changed source,
# dependency closure, Candid, or Wasm artifact.
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly pin_file="$repository_root/docs/icp/evidence/zendb/v2.0.1.pin.json"
readonly source_url="https://github.com/NatLabs/ZenDB.git"
readonly source_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
readonly source_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
readonly source_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
readonly source_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"
readonly candid_sha256="6ded91f5fba2ffc85f93bd870e5cd1c4a4bea4f0d2c5b2991a4ff1b6ebb7e79d"
readonly wasm_sha256="513a401d21c2ada26c84ba6b0788c694aae0d230689535fb4b3870dcc2c90a5c"

if [[ ! -f "$pin_file" ]]; then
  echo "ZenDB pin manifest is missing: $pin_file" >&2
  exit 1
fi

for command in git mops dfx sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

readonly mops_version="$(mops --version | head -n 1)"
if [[ "$mops_version" != "CLI 2.19.2" ]]; then
  echo "Expected Mops CLI 2.19.2; found: $mops_version" >&2
  exit 1
fi

if [[ "$(dfx --version)" != "dfx 0.32.0" ]]; then
  echo "Expected dfx 0.32.0; found: $(dfx --version)" >&2
  exit 1
fi

workdir="${M1_ZENDB_WORKDIR:-$(mktemp -d /tmp/meritocracy-zendb-pin.XXXXXXXX)}"
readonly workdir
source_dir="$workdir/zendb"
local_replica_started=false

stop_local_replica() {
  if [[ "$local_replica_started" == true ]]; then
    (cd "$source_dir" && dfx stop >/dev/null 2>&1) || true
  fi
}
trap stop_local_replica EXIT

if [[ -e "$source_dir" ]]; then
  echo "Refusing to reuse an existing source directory: $source_dir" >&2
  exit 1
fi

git clone --filter=blob:none --no-checkout "$source_url" "$source_dir"
git -C "$source_dir" checkout --detach "$source_commit"

[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$source_commit" ]]
git -C "$source_dir" diff --quiet
[[ "$(git -C "$source_dir" archive --format=tar HEAD | sha256sum | awk '{print $1}')" == "$source_archive_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$source_mops_toml_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$source_mops_lock_sha256" ]]

cd "$source_dir"
mops install --lock check
dfx start --clean --background
local_replica_started=true
dfx canister create zendb-canister-eop
dfx build zendb-canister-eop

artifact_dir=".dfx/local/canisters/zendb-canister-eop"
[[ "$(sha256sum "$artifact_dir/zendb-canister-eop.did" | awk '{print $1}')" == "$candid_sha256" ]]
[[ "$(sha256sum "$artifact_dir/zendb-canister-eop.wasm" | awk '{print $1}')" == "$wasm_sha256" ]]
dfx stop
local_replica_started=false

echo "ZenDB v2.0.1 pin reproduced successfully. Temporary checkout: $workdir"
