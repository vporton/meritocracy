#!/usr/bin/env bash
# Runs the M1 storage-authority Candid-boundary proof on an isolated local
# replica. It creates only disposable canisters and a disposable DFX identity;
# no Meritocracy canister, ZenDB collection, production data, or wallet is
# deployed or accessed.
set -euo pipefail

readonly dfx_operation_timeout_seconds="180"
readonly logical_id="meritocracy-legacy-logical-id-v1:users:sha256:0123456789abcdef"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
caller_fixture="$repo_root/fixtures/storage_authority/StorageAuthorityCaller.mo"

for command in dfx mops node openssl timeout; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

[[ "$(dfx --version)" == "dfx 0.32.0" ]] || {
  echo "Expected dfx 0.32.0; found: $(dfx --version)" >&2
  exit 1
}
[[ "$(mops --version | head -n 1)" == "CLI 2.19.2" ]] || {
  echo "Expected Mops CLI 2.19.2; found: $(mops --version | head -n 1)" >&2
  exit 1
}
[[ -f "$caller_fixture" ]] || {
  echo "Missing storage-authority caller fixture" >&2
  exit 1
}

workdir="$(mktemp -d /tmp/meritocracy-storage-authority.XXXXXXXX)"
dfx_config_root="$(mktemp -d /tmp/meritocracy-storage-authority-dfx.XXXXXXXX)"
local_replica_started=false

cleanup() {
  if [[ "$local_replica_started" == true ]]; then
    # Do not let a replica shutdown stall a CI worker or retain its temporary
    # directory after an interrupted proof.
    (cd "$workdir" && timeout --foreground --kill-after=10s 20s dfx stop >/dev/null 2>&1) || true
  fi
  rm -rf -- "$workdir" "$dfx_config_root"
}
trap cleanup EXIT

# Build in a temporary project so the proof never writes DFX/Mops artifacts to
# the repository. Symlinking source files keeps the tested code identical to
# this checkout without copying ignored credentials such as backend/.env.
ln -s "$repo_root/canisters" "$workdir/canisters"
ln -s "$repo_root/fixtures" "$workdir/fixtures"
cp "$repo_root/dfx.json" "$repo_root/mops.toml" "$repo_root/mops.lock" "$workdir/"

(cd "$workdir" && node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync("dfx.json", "utf8"));
  config.networks ??= {};
  config.networks.local = { bind: "127.0.0.1:0", type: "ephemeral" };
  const storageAuthority = config.canisters.storage_authority;
  config.canisters = { storage_authority: storageAuthority };
  for (const name of [
    "core_caller", "governance_caller", "unrelated_caller",
  ]) {
    config.canisters[name] = {
      type: "motoko",
      main: "fixtures/storage_authority/StorageAuthorityCaller.mo",
      candid: "fixtures/storage_authority/storage_authority_caller.did",
    };
  }
  config.canisters.boundary_verifier = {
    type: "motoko",
    main: "fixtures/storage_authority/StorageAuthorityBoundaryVerifier.mo",
    candid: "fixtures/storage_authority/storage_authority_boundary_verifier.did",
  };
  fs.writeFileSync("dfx.json", `${JSON.stringify(config, null, 2)}\n`);
')

# The replica lifecycle runs in an isolated config root. A temporary default
# key avoids recovery-phrase output; every ingress-capable command explicitly
# selects either the built-in anonymous identity or the disposable bootstrap
# identity below. Neither can touch a developer keyring or wallet.
export DFX_CONFIG_ROOT="$dfx_config_root"
dfx_default_identity_dir="$DFX_CONFIG_ROOT/.config/dfx/identity/default"
bootstrap_identity_pem="$dfx_config_root/bootstrap-identity.pem"
mkdir -p "$dfx_default_identity_dir"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 \
  -out "$dfx_default_identity_dir/identity.pem" >/dev/null 2>&1
chmod 600 "$dfx_default_identity_dir/identity.pem"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 \
  -out "$bootstrap_identity_pem" >/dev/null 2>&1
chmod 600 "$bootstrap_identity_pem"
dfx identity import --storage-mode plaintext bootstrap "$bootstrap_identity_pem" >/dev/null 2>&1
rm -f -- "$bootstrap_identity_pem"

run_dfx() {
  local identity="$1"
  shift
  timeout --foreground --kill-after=10s "$dfx_operation_timeout_seconds" \
    dfx --identity "$identity" "$@"
}

assert_call_equals() {
  local identity="$1"
  local canister="$2"
  local method="$3"
  local argument="$4"
  local expected="$5"
  local actual
  actual="$(run_dfx "$identity" canister call "$canister" "$method" "$argument" --network local)"
  # DFX prints one outer pair of Candid tuple parentheses for every result;
  # compare the value itself so the proof remains about authorization, not CLI
  # presentation of a single return value.
  actual="${actual#(}"
  actual="${actual%)}"
  [[ "$actual" == "$expected" ]] || {
    echo "Unexpected proof result for $canister.$method: $actual" >&2
    exit 1
  }
}

(cd "$workdir" && dfx start --clean --background >/dev/null 2>&1) || {
  echo "Failed to start the disposable local DFX replica" >&2
  exit 1
}
local_replica_started=true
(cd "$workdir" && run_dfx anonymous ping local)

canisters=(
  storage_authority
  core_caller governance_caller unrelated_caller boundary_verifier
)
for canister in "${canisters[@]}"; do
  (cd "$workdir" && run_dfx bootstrap canister create "$canister" --network local --no-wallet)
done

storage_authority="$(cd "$workdir" && run_dfx bootstrap canister id storage_authority --network local)"
core="$(cd "$workdir" && run_dfx bootstrap canister id core_caller --network local)"
governance="$(cd "$workdir" && run_dfx bootstrap canister id governance_caller --network local)"
unrelated="$(cd "$workdir" && run_dfx bootstrap canister id unrelated_caller --network local)"
boundary_verifier="$(cd "$workdir" && run_dfx bootstrap canister id boundary_verifier --network local)"

# These three fixed, non-anonymous canister principals are not deployed and
# are never called. They make the initializer's six-distinct-principal rule an
# actual Candid installation precondition while keeping the proof focused on
# the direct-ingress and inter-canister callers it exercises.
workflow="ryjl3-tyaaa-aaaaa-aaaba-cai"
treasury="rrkah-fqaaa-aaaaa-aaaaq-cai"
archive="r7inp-6aaaa-aaaaa-aaabq-cai"
evidence="rkp4c-7iaaa-aaaaa-aaaca-cai"

config_argument="(record { core = principal \"$core\"; workflow = principal \"$workflow\"; treasury = principal \"$treasury\"; archive = principal \"$archive\"; evidence = principal \"$evidence\"; governance = principal \"$governance\" })"
(cd "$workdir" && run_dfx bootstrap build --all --network local)
(cd "$workdir" && node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync("dfx.json", "utf8"));
  const [storage, core, governance, unrelated, storageArgument] = process.argv.slice(1);
  config.canisters.storage_authority.init_arg = storageArgument;
  for (const name of ["core_caller", "governance_caller", "unrelated_caller"]) {
    config.canisters[name].init_arg = `(principal "${storage}")`;
  }
  config.canisters.boundary_verifier.init_arg =
    `(principal "${core}", principal "${governance}", principal "${unrelated}")`;
  fs.writeFileSync("dfx.json", `${JSON.stringify(config, null, 2)}\n`);
' "$storage_authority" "$core" "$governance" "$unrelated" "$config_argument")
(cd "$workdir" && run_dfx bootstrap canister install --all --network local)

# Direct browser/user ingress and the bootstrap/deployer identity cannot read
# or mutate, while neither direct caller may obtain the governance audit.
(cd "$workdir" && assert_call_equals anonymous storage_authority coreReadProbe "(\"$logical_id\")" "variant { anonymousCaller }")
(cd "$workdir" && assert_call_equals bootstrap storage_authority coreWriteProbe "(\"$logical_id\")" "variant { callerNotAllowed }")

# Only each configured canister can use its fixed owner surface. An unrelated
# canister, a cross-owner request, and governance-as-data-caller are denied.
(cd "$workdir" && assert_call_equals bootstrap boundary_verifier verify "(\"$logical_id\")" "true")

echo "Storage-authority local Candid-boundary proof passed."
