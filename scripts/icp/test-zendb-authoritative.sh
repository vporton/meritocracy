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
readonly pocket_ic_version="14.0.0"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof_test="$repo_root/fixtures/zendb/M1AuthoritativeProof.mo"

for command in git mops dfx sha256sum install stat tar moc-wrapper; do
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

# ZenDB v2.0.1 does not pin a PocketIC runner in its source manifest. Add the
# reviewed runner pin only after verifying the pristine source/lock hashes, and
# only in this ephemeral checkout. This avoids relying on Mops' deprecated DFX
# version detection while leaving the pinned ZenDB dependency closure intact.
printf '\npocket-ic = "%s"\n' "$pocket_ic_version" >> "$source_dir/mops.toml"

cd "$source_dir"
# `pic-js-mops` installs a test Wasm in one ingress message. PocketIC enforces
# a 2 MiB ingress limit, while the remote-CanisterDB test actor statically
# links the candidate database implementation. Detect that transport boundary
# before invoking Mops: without this check its client retries the oversized
# installation indefinitely and never reaches `runTests`.
mops install
readonly pocket_ic_max_ingress_bytes=2097152
proof_wasm="$workdir/M1AuthoritativeProof.Test.wasm"
moc-wrapper \
  -o="$proof_wasm" \
  --hide-warnings \
  --error-detail=2 \
  $(mops sources) \
  "$test_target"
proof_wasm_bytes="$(stat -c%s "$proof_wasm")"
if (( proof_wasm_bytes > pocket_ic_max_ingress_bytes )); then
  echo "M1 authoritative proof is blocked before PocketIC execution: compiled test Wasm is ${proof_wasm_bytes} bytes, above the pic-js-mops single-ingress limit of ${pocket_ic_max_ingress_bytes} bytes." >&2
  echo "Reduce or split the harness, or pin and prove a chunked-install runner; do not report this compilation as a successful PocketIC proof." >&2
  exit 1
fi

# Explicit PocketIC selection makes the test local-only. The filter selects
# only the copied synthetic proof, not an unbounded upstream suite.
mops test --mode replica --replica pocket-ic M1AuthoritativeProof.Test -r verbose

echo "ZenDB v2.0.1 M1 synthetic authoritative-data proof passed. Source checkout: $source_dir"
