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
readonly upgrade_owner_canister="m1-upgrade-owner"
readonly upgrade_canister="zendb-canister"
readonly test_canister_cycles="30000000000000"
readonly upgrade_canister_cycles="10000000000000"
readonly dfx_operation_timeout_seconds="180"
readonly dfx_build_timeout_seconds="360"
# The proof actor statically links three synthetic owner fixtures as well as
# the candidate database implementation. O3 compilation of that disposable
# test harness exceeded the existing per-operation bound before any local
# canister was installed. O1 keeps the same Motoko semantics while allowing
# the bounded local behavioral proof to run. The separately built upgrade
# artifact below intentionally remains O3, matching the pinned candidate.
readonly proof_actor_optimization="O1"

export M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION="${M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION:-$proof_actor_optimization}"
case "$M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION" in
  O0|O1|O2|O3) ;;
  *)
    echo "M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION must be one of O0, O1, O2, or O3" >&2
    exit 1
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof_test="$repo_root/fixtures/zendb/M1AuthoritativeProof.mo"
proof_owner="$repo_root/fixtures/zendb/M1IntentOwner.mo"
proof_archive_owner="$repo_root/fixtures/zendb/M1ArchiveIntentOwner.mo"
proof_archive_sink="$repo_root/fixtures/zendb/M1ArchiveSink.mo"
proof_upgrade_owner="$repo_root/fixtures/zendb/M1UpgradeOwner.mo"

for command in git mops dfx didc sha256sum gzip install tar node timeout openssl; do
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
[[ -f "$proof_owner" ]] || {
  echo "Missing proof owner actor: $proof_owner" >&2
  exit 1
}
[[ -f "$proof_archive_owner" ]] || {
  echo "Missing proof archive owner actor: $proof_archive_owner" >&2
  exit 1
}
[[ -f "$proof_archive_sink" ]] || {
  echo "Missing proof archive receiver: $proof_archive_sink" >&2
  exit 1
}
[[ -f "$proof_upgrade_owner" ]] || {
  echo "Missing post-upgrade proof owner: $proof_upgrade_owner" >&2
  exit 1
}

workdir="${M1_ZENDB_AUTHORITATIVE_WORKDIR:-$(mktemp -d /tmp/meritocracy-zendb-authoritative.XXXXXXXX)}"
source_dir="$workdir/zendb"
local_replica_started=false
dfx_config_root="$(mktemp -d /tmp/meritocracy-zendb-authoritative-dfx.XXXXXXXX)"

# DFX 0.32.0 hangs after starting a background replica when `start` is given
# `--identity anonymous`.  Replica lifecycle commands do not sign ingress, so
# keep them identity-free while isolating DFX's config root.  This prevents DFX
# from discovering or importing a developer PEM/keyring during start or stop.
# DFX may create a disposable default identity in that isolated directory; it
# is never used for canister operations, its bootstrap output is suppressed,
# and the directory is removed at exit. Every command that can create, install,
# deploy, or call a canister still uses the built-in anonymous identity below.
export DFX_CONFIG_ROOT="$dfx_config_root"
dfx_default_identity_dir="$DFX_CONFIG_ROOT/.config/dfx/identity/default"
mkdir -p "$dfx_default_identity_dir"
# DFX initializes a default identity even when each ingress-capable command
# names `--identity anonymous`. Seed that isolated, disposable config with an
# unused local key so DFX cannot print a recovery phrase. This key is never
# selected for any operation and is removed with the config root at exit.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 \
  -out "$dfx_default_identity_dir/identity.pem" >/dev/null 2>&1
chmod 600 "$dfx_default_identity_dir/identity.pem"

# A local replica that cannot finish an operation is not proof evidence. Bound
# every DFX subprocess so CI and operator machines fail closed instead of
# retaining a replica or waiting indefinitely after an interrupted install.
# The exact O3 upgrade artifact needs a longer, but still finite, bound than
# ingress operations on the pinned toolchain.
run_dfx() {
  # The built-in anonymous identity has no PEM/keyring dependency and cannot
  # select a developer's wallet or signing authority. This synthetic runner
  # never needs a non-anonymous caller; `--no-wallet` remains explicit on the
  # provisional local canister creation command below.
  local timeout_seconds="$dfx_operation_timeout_seconds"
  if [[ "$1" == "build" ]]; then
    timeout_seconds="$dfx_build_timeout_seconds"
  fi
  timeout --foreground --kill-after=10s "$timeout_seconds" dfx --identity anonymous "$@"
}

run_dfx_replica() {
  timeout --foreground --kill-after=10s "$dfx_operation_timeout_seconds" dfx "$@"
}

start_local_replica() {
  # DFX prints a recovery phrase if it initializes its isolated disposable
  # default identity. It is unrelated to this anonymous test and must never
  # enter CI or operator logs. A later anonymous ping gives the fail-closed
  # health signal; no detailed startup output is evidence.
  if ! run_dfx_replica start --clean --background >/dev/null 2>&1; then
    echo "Failed to start the disposable local DFX replica" >&2
    return 1
  fi
}

stop_local_replica() {
  if [[ "$local_replica_started" == true ]]; then
    (cd "$source_dir" && run_dfx_replica stop >/dev/null 2>&1) || true
  fi
  rm -rf -- "$dfx_config_root"
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
owner_target="$source_dir/tests/cluster-tests/M1IntentOwner.mo"
archive_owner_target="$source_dir/tests/cluster-tests/M1ArchiveIntentOwner.mo"
archive_sink_target="$source_dir/tests/cluster-tests/M1ArchiveSink.mo"
upgrade_owner_target="$source_dir/tests/cluster-tests/M1UpgradeOwner.mo"
exact_upgrade_artifact_target="$source_dir/tests/cluster-tests/M1ExactUpgradeArtifact.mo"
install -m 0644 "$proof_test" "$test_target"
install -m 0644 "$proof_owner" "$owner_target"
install -m 0644 "$proof_archive_owner" "$archive_owner_target"
install -m 0644 "$proof_archive_sink" "$archive_sink_target"
install -m 0644 "$proof_upgrade_owner" "$upgrade_owner_target"

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
    optimize: process.env.M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION ?? "O1",
    shrink: true,
    metadata: [{ name: "candid:service" }]
  };
  config.canisters["m1-upgrade-owner"] = {
    type: "motoko",
    main: "tests/cluster-tests/M1UpgradeOwner.mo",
    optimize: process.env.M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION ?? "O1",
    shrink: true,
    metadata: [{ name: "candid:service" }]
  };
  // Build the upstream actor-class source itself for the exact candidate
  // artifact. The standalone post-upgrade owner installs this same artifact
  // initially and on upgrade; it does not claim compatibility with the
  // separate actor-class instances created by the proof actor.
  config.canisters["zendb-canister"] = {
    type: "motoko",
    main: "src/RemoteInstance/CanisterDB/lib.mo",
    declarations: { node_compatibility: true },
    args: "--enhanced-orthogonal-persistence --max-stable-pages 6553600",
    optimize: "O3",
    shrink: true,
    metadata: [{ name: "candid:service" }]
  };
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
' dfx.json

start_local_replica
local_replica_started=true
# Fail before creation if this checkout did not start its own local network.
run_dfx ping local
run_dfx canister create "$test_canister" --network local --no-wallet --with-cycles "$test_canister_cycles"
run_dfx canister create "$upgrade_owner_canister" --network local --no-wallet --with-cycles "$test_canister_cycles"
upgrade_owner_principal="$(run_dfx canister id "$upgrade_owner_canister" --network local)"
run_dfx canister create "$upgrade_canister" --network local --no-wallet --with-cycles "$upgrade_canister_cycles" --controller "$upgrade_owner_principal"
upgrade_canister_principal="$(run_dfx canister id "$upgrade_canister" --network local)"
echo "Building the disposable proof actor with $M1_ZENDB_AUTHORITATIVE_PROOF_OPTIMIZATION; the upgrade artifact remains O3."
run_dfx build "$upgrade_canister" --network local
upgrade_wasm="$(find "$source_dir/.dfx/local/canisters/$upgrade_canister" -maxdepth 1 -type f -name '*.wasm' -print -quit)"
[[ -s "$upgrade_wasm" ]] || {
  echo "Missing compiled upgrade artifact" >&2
  exit 1
}
# `install_code` accepts a gzip-compressed Wasm module. Use deterministic gzip
# so the owner binds a reproducible, exact transport artifact while keeping the
# ingress below the local HTTP boundary (the raw candidate Wasm is 2.66 MiB).
upgrade_wasm_transport="$workdir/zendb-canister.wasm.gz"
gzip -n -c "$upgrade_wasm" > "$upgrade_wasm_transport"
# Bind the proof-owner upgrade endpoint to this exact locally built artifact.
# The module contains only the 32-byte digest and size, never the Wasm itself.
# This makes the anonymous test caller able to request only this one pinned
# upgrade, while `install_code` remains invoked by the child-controller.
node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const [wasmPath, targetPath] = process.argv.slice(1);
  const wasm = fs.readFileSync(wasmPath);
  const digest = crypto.createHash("sha256").update(wasm).digest();
  const literal = [...digest].map((byte) => `\\${byte.toString(16).padStart(2, "0")}`).join("");
  fs.writeFileSync(
    targetPath,
    `// Generated only in the disposable M1 proof checkout.\nmodule {\n  public let byteLength : Nat = ${wasm.length};\n  public let sha256 : Blob = "${literal}";\n};\n`,
  );
' "$upgrade_wasm_transport" "$exact_upgrade_artifact_target"
run_dfx build "$test_canister" --network local
test_wasm="$(find "$source_dir/.dfx/local/canisters/$test_canister" -maxdepth 1 -type f -name '*.wasm' -print -quit)"
[[ -s "$test_wasm" ]] || {
  echo "Missing compiled proof artifact" >&2
  exit 1
}
run_dfx build "$upgrade_owner_canister" --network local
upgrade_owner_wasm="$(find "$source_dir/.dfx/local/canisters/$upgrade_owner_canister" -maxdepth 1 -type f -name '*.wasm' -print -quit)"
[[ -s "$upgrade_owner_wasm" ]] || {
  echo "Missing compiled post-upgrade owner artifact" >&2
  exit 1
}
# `dfx deploy` recompiles the already-built proof actor. Install the exact
# artifact just produced above so the bounded runner does not spend a second
# full compiler pass before exercising its synthetic sagas.
run_dfx canister install "$test_canister" --network local --mode reinstall --wasm "$test_wasm" --yes
run_dfx canister call "$test_canister" --network local runTests
run_dfx canister install "$upgrade_owner_canister" --network local --mode reinstall --wasm "$upgrade_owner_wasm" --yes
[[ "$(run_dfx canister call "$upgrade_owner_canister" --network local configure "(principal \"$upgrade_canister_principal\")")" == *true* ]] || {
  echo "Post-upgrade owner did not bind its sole-controller database target" >&2
  exit 1
}
# DFX accepts a Candid argument file, avoiding shell argument limits while
# preserving the Wasm's exact bytes. The call is anonymous, but the target
# database has only the synthetic owner as controller; that owner accepts one
# digest-bound candidate artifact and invokes management-canister install.
upgrade_argument_text="$workdir/exact-upgrade-argument.did"
upgrade_argument_hex="$workdir/exact-upgrade-argument.hex"
node -e '
  const fs = require("node:fs");
  const wasm = fs.readFileSync(process.argv[1]);
  const literal = [...wasm].map((byte) => `\\${byte.toString(16).padStart(2, "0")}`).join("");
  fs.writeFileSync(process.argv[2], `(blob "${literal}")\n`);
' "$upgrade_wasm_transport" "$upgrade_argument_text"
# `--argument-file` defaults to textual Candid, whose escaped 2.66 MiB Wasm
# exceeds the replica HTTP boundary. Encode it locally, then hand DFX the
# binary Candid argument so the ingress body is the bounded Wasm plus a small
# Candid envelope rather than its three-byte-per-byte text representation.
didc encode --format hex < "$upgrade_argument_text" | tr -d '\n' > "$upgrade_argument_hex"
[[ "$(run_dfx canister call "$upgrade_owner_canister" --network local installInitialExact --type raw --argument-file "$upgrade_argument_hex")" == *true* ]] || {
  echo "Owning proof canister did not install the exact pinned initial Wasm" >&2
  exit 1
}
[[ "$(run_dfx canister call "$upgrade_owner_canister" --network local prepareAndRevoke)" == *true* ]] || {
  echo "Post-upgrade owner could not prepare and revoke its bootstrap grant" >&2
  exit 1
}
[[ "$(run_dfx canister call "$upgrade_owner_canister" --network local upgradeOwnedExact --type raw --argument-file "$upgrade_argument_hex")" == *true* ]] || {
  echo "Owning proof canister did not upgrade the exact pinned Wasm" >&2
  exit 1
}
[[ "$(run_dfx canister call "$upgrade_owner_canister" --network local verifyPostUpgradeRevocation)" == *true* ]] || {
  echo "Post-upgrade grant revocation audit failed" >&2
  exit 1
}
run_dfx stop
local_replica_started=false

echo "ZenDB v2.0.1 M1 synthetic authoritative-data proof passed on the pinned local DFX replica. Source checkout: $source_dir"
