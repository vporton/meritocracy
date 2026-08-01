#!/usr/bin/env bash
# Runs the pinned ZenDB remote-CanisterDB RBAC baseline on PocketIC.
#
# It is deliberately limited to the upstream synthetic test actor: this is
# evidence about the exact pinned remote RBAC implementation, not an approval
# to deploy it or make any collection authoritative. It never selects --ic,
# does not accept credentials, and only creates ephemeral PocketIC canisters.
set -euo pipefail

readonly source_url="https://github.com/NatLabs/ZenDB.git"
readonly source_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
readonly source_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
readonly source_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
readonly source_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"

for command in git mops dfx sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

if [[ "$(mops --version | head -n 1)" != "CLI 2.19.2" ]]; then
  echo "Expected Mops CLI 2.19.2; found: $(mops --version | head -n 1)" >&2
  exit 1
fi

if [[ "$(dfx --version)" != "dfx 0.32.0" ]]; then
  echo "Expected dfx 0.32.0; found: $(dfx --version)" >&2
  exit 1
fi

workdir="${M1_ZENDB_RBAC_WORKDIR:-$(mktemp -d /tmp/meritocracy-zendb-rbac.XXXXXXXX)}"
source_dir="${M1_ZENDB_SOURCE_DIR:-$workdir/zendb}"

if [[ -n "${M1_ZENDB_SOURCE_DIR:-}" ]]; then
  [[ -d "$source_dir/.git" ]] || {
    echo "M1_ZENDB_SOURCE_DIR must name a ZenDB git checkout: $source_dir" >&2
    exit 1
  }
else
  git clone --filter=blob:none --no-checkout "$source_url" "$source_dir"
  git -C "$source_dir" checkout --detach "$source_commit"
fi

[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$source_commit" ]]
git -C "$source_dir" diff --quiet
[[ "$(git -C "$source_dir" archive --format=tar HEAD | sha256sum | awk '{print $1}')" == "$source_archive_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$source_mops_toml_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$source_mops_lock_sha256" ]]

cd "$source_dir"
# PocketIC is selected explicitly. The Mops 2.19.2 runner uses the PocketIC
# bundled with the exact DFX 0.32.0 pin when the source lock has no separate
# PocketIC package. The test's distinct proxy canisters are essential: calls
# must be authenticated as the proxy principal rather than the test owner.
mops test --mode replica --replica pocket-ic CanisterDB.Test -r verbose

echo "ZenDB v2.0.1 isolated RBAC baseline passed. Source checkout: $source_dir"
