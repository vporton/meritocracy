#!/usr/bin/env bash
# Runs the M1 synthetic authoritative-data proof against the exact pinned
# ZenDB source. The proof copies one test into an ephemeral checkout only; it
# never deploys a Meritocracy canister, uses --ic, accepts credentials, or
# touches production data.
set -euo pipefail

readonly source_url="https://github.com/NatLabs/ZenDB.git"
readonly source_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
readonly source_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
readonly source_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
readonly source_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"
readonly test_canister="m1-authoritative-proof"
readonly test_canister_cycles="20000000000000"
readonly dfx_operation_timeout_seconds="180"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof_test="$repo_root/fixtures/zendb/M1AuthoritativeProof.mo"

for command in git mops dfx sha256sum install tar node timeout; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

# `mops toolchain init` installs this setting in interactive shell profiles.
# Set it explicitly because CI and non-interactive shell invocations do not
# necessarily reload those profiles before Mops starts DFX/PocketIC.
export DFX_MOC_PATH="moc-wrapper"

[[ "$(mops --version | head -n 1)" == "CLI 2.19.2" ]] || {
  echo "Expected Mops CLI 2.19.2; found: $(mops --version | head -n 1)" >&2
  exit 1
}
[[ "$(dfx --version)" == "dfx 0.32.0" ]] || {
  echo "Expected dfx 0.32.0; found: $(dfx --version)" >&2
  exit 1
}
[[ -f "$proof_test" ]] || {
  echo "Missing proof test: $proof_test" >&2
  exit 1
}

workdir="${M1_ZENDB_AUTHORITATIVE_WORKDIR:-$(mktemp -d /tmp/meritocracy-zendb-authoritative.XXXXXXXX)}"
source_dir="$workdir/zendb"
local_replica_started=false

# A local replica that cannot finish an operation is not proof evidence. Bound
# every DFX subprocess so CI and operator machines fail closed instead of
# retaining a replica or waiting indefinitely after an interrupted install.
run_dfx() {
  timeout --foreground --kill-after=10s "$dfx_operation_timeout_seconds" dfx "$@"
}

stop_local_replica() {
  if [[ "$local_replica_started" == true ]]; then
    (cd "$source_dir" && run_dfx stop >/dev/null 2>&1) || true
  fi
}
trap stop_local_replica EXIT

if [[ -n "${M1_ZENDB_SOURCE_DIR:-}" ]]; then
  provided_source_dir="$M1_ZENDB_SOURCE_DIR"
  [[ -d "$provided_source_dir/.git" ]] || {
    echo "M1_ZENDB_SOURCE_DIR must name a ZenDB git checkout: $provided_source_dir" >&2
    exit 1
  }
  # Never inject the synthetic test or runner pin into an operator-provided
  # checkout. Exporting the exact commit keeps that checkout read-only and,
  # unlike a --no-local clone, cannot make a partial/promisor checkout fetch
  # from its remote while this local-only proof is running.
  git -C "$provided_source_dir" rev-parse --verify "$source_commit^{commit}" >/dev/null
  provided_archive="$workdir/zendb-source.tar"
  git -C "$provided_source_dir" archive --format=tar "$source_commit" > "$provided_archive"
  [[ "$(sha256sum "$provided_archive" | awk '{print $1}')" == "$source_archive_sha256" ]]
  mkdir "$source_dir"
  tar -xf "$provided_archive" -C "$source_dir"
else
  git clone --filter=blob:none --no-checkout "$source_url" "$source_dir"
  git -C "$source_dir" checkout --detach "$source_commit"
fi

if [[ -z "${M1_ZENDB_SOURCE_DIR:-}" ]]; then
  [[ "$(git -C "$source_dir" rev-parse HEAD)" == "$source_commit" ]]
  git -C "$source_dir" diff --quiet
  [[ "$(git -C "$source_dir" archive --format=tar HEAD | sha256sum | awk '{print $1}')" == "$source_archive_sha256" ]]
fi
[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$source_mops_toml_sha256" ]]
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$source_mops_lock_sha256" ]]

test_target="$source_dir/tests/cluster-tests/M1AuthoritativeProof.Test.mo"
install -m 0644 "$proof_test" "$test_target"

cd "$source_dir"
# `pic-js-mops` installs a test Wasm in one ingress message. The synthetic
# actor statically links the candidate database implementation and exceeds that
# 2 MiB request boundary, so run the same locally compiled actor through the
# pinned DFX local-replica installer instead. Its successful local install is
# required evidence that this runner's compressed install transport can handle
# the exact generated artifact; compilation alone is never a pass.
# Do not invoke `mops install` here. Mops 2.19.2 performs an unrelated
# API-compatibility request before that command resolves the pinned lock. DFX
# invokes the source's pinned `mops sources` packtool while building this proof
# actor, so this runner has no dependency-resolution network path after the
# exact source archive has been verified.
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  // Avoid the shared 127.0.0.1:4943 developer replica. DFX writes the chosen
  // ephemeral loopback endpoint into this checkout, and every operation below
  // names `--network local` so it cannot fall through to another configured
  // network.
  config.networks ??= {};
  config.networks.local = { bind: "127.0.0.1:0", type: "ephemeral" };
  config.canisters["m1-authoritative-proof"] = {
    type: "motoko",
    main: "tests/cluster-tests/M1AuthoritativeProof.Test.mo",
    optimize: "O3",
    shrink: true,
    metadata: [{ name: "candid:service" }]
  };
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
' dfx.json

run_dfx start --clean --background
local_replica_started=true
# Fail before creation if this checkout did not start its own local network.
run_dfx ping local
run_dfx canister create "$test_canister" --network local --no-wallet --with-cycles "$test_canister_cycles"
run_dfx build "$test_canister" --network local
run_dfx deploy "$test_canister" --network local --mode reinstall --yes
run_dfx canister call "$test_canister" --network local runTests
run_dfx stop
local_replica_started=false

echo "ZenDB v2.0.1 M1 synthetic authoritative-data proof passed on the pinned local DFX replica. Source checkout: $source_dir"
