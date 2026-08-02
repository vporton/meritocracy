#!/usr/bin/env bash
# Runs the M1 bounded synthetic benchmark against the exact pinned ZenDB
# source. It uses only a fresh local DFX replica and retains its temporary
# checkout for audit; it never deploys Meritocracy canisters or uses --ic.
set -euo pipefail

readonly source_url="https://github.com/NatLabs/ZenDB.git"
readonly source_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
readonly source_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
readonly source_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
readonly source_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"
readonly test_canister="m1-bounded-benchmark"
readonly test_canister_cycles="20000000000000"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof_test="$repo_root/fixtures/zendb/M1BoundedBenchmark.mo"

for command in git mops dfx sha256sum install tar node; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

export DFX_MOC_PATH="moc-wrapper"
[[ "$(mops --version | head -n 1)" == "CLI 2.19.2" ]] || { echo "Expected Mops CLI 2.19.2" >&2; exit 1; }
[[ "$(dfx --version)" == "dfx 0.32.0" ]] || { echo "Expected dfx 0.32.0" >&2; exit 1; }
[[ -f "$proof_test" ]] || { echo "Missing proof test: $proof_test" >&2; exit 1; }

workdir="${M1_ZENDB_BENCHMARK_WORKDIR:-$(mktemp -d /tmp/meritocracy-zendb-benchmark.XXXXXXXX)}"
source_dir="$workdir/zendb"
local_replica_started=false

stop_local_replica() {
  if [[ "$local_replica_started" == true ]]; then
    (cd "$source_dir" && dfx stop >/dev/null 2>&1) || true
  fi
}
trap stop_local_replica EXIT

if [[ -n "${M1_ZENDB_SOURCE_DIR:-}" ]]; then
  provided_source_dir="$M1_ZENDB_SOURCE_DIR"
  [[ -d "$provided_source_dir/.git" ]] || { echo "M1_ZENDB_SOURCE_DIR must name a ZenDB git checkout" >&2; exit 1; }
  git -C "$provided_source_dir" rev-parse --verify "$source_commit^{commit}" >/dev/null
  provided_archive="$workdir/zendb-source.tar"
  git -C "$provided_source_dir" archive --format=tar "$source_commit" > "$provided_archive"
  [[ "$(sha256sum "$provided_archive" | awk '{print $1}')" == "$source_archive_sha256" ]]
  mkdir "$source_dir"
  tar -xf "$provided_archive" -C "$source_dir"
else
  git clone --filter=blob:none --no-checkout "$source_url" "$source_dir"
  git -C "$source_dir" checkout --detach "$source_commit"
  [[ "$(git -C "$source_dir" archive --format=tar HEAD | sha256sum | awk '{print $1}')" == "$source_archive_sha256" ]]
fi

[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$source_mops_toml_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$source_mops_lock_sha256" ]]
install -m 0644 "$proof_test" "$source_dir/tests/cluster-tests/M1BoundedBenchmark.Test.mo"

cd "$source_dir"
# Do not invoke `mops install` here. Mops 2.19.2 performs an unrelated
# API-compatibility request before that command runs. DFX invokes the pinned
# source's `mops sources` packtool when it builds the proof actor instead.
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  // Use an ephemeral project-local bind address rather than the DFX shared
  // 127.0.0.1:4943 default. This keeps the synthetic proof isolated from a
  // developer local replica and lets DFX publish the selected local port
  // to every later `--network local` command in this checkout.
  config.networks ??= {};
  config.networks.local = { bind: "127.0.0.1:0", type: "ephemeral" };
  config.canisters["m1-bounded-benchmark"] = {
    type: "motoko",
    main: "tests/cluster-tests/M1BoundedBenchmark.Test.mo",
    optimize: "O3",
    shrink: true,
    metadata: [{ name: "candid:service" }]
  };
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
' dfx.json

dfx start --clean --background
local_replica_started=true
# Verify the exact endpoint before creating anything. Every subsequent DFX
# command repeats `--network local`, so an unset/incorrect default cannot
# fall through to a remotely configured network.
dfx ping local
dfx canister create "$test_canister" --network local --no-wallet --with-cycles "$test_canister_cycles"
dfx build "$test_canister" --network local
dfx deploy "$test_canister" --network local --mode reinstall --yes
dfx canister call "$test_canister" --network local runTests
dfx stop
local_replica_started=false

echo "ZenDB v2.0.1 M1 bounded synthetic benchmark passed on the pinned local DFX replica. Source checkout: $source_dir"
