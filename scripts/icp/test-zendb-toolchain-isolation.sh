#!/usr/bin/env bash
# Verifies that the proposed ZenDB v2.0.1 candidate is evaluated with its
# own pinned compiler and can never be imported accidentally by the
# application/OAuth build.  It is intentionally a negative compatibility
# proof at the current pin: a successful ZenDB build would require an updated
# review of this script and of the candidate record.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
expected_application_moc="0.16.3"
expected_zendb_moc="1.4.1"
expected_commit="481d9cdac1ac41f01ba7892cfa720dbe4e87e4cd"
expected_archive_sha256="332e88c5ed8a777472d0843597d0b3c080b5b6f6e53d251b52aa0883b3444844"
expected_mops_toml_sha256="09f5e7cd4281ca46953419cdad9fa1a1b376d211288a66af780f505b07336d18"
expected_mops_lock_sha256="79b2a699c484e57ee5bbaa20e50d1da7c556c4e3a132ff7a655523eeffced267"
expected_zendb_moc_sha256="2c7f1c242601db08465d9c96f9a933cc4458d2d74c8587261f970797c32f9d9d"

if ! grep -Fq "moc = \"${expected_application_moc}\"" "$repo_root/mops.toml"; then
  echo "Application Motoko compiler pin changed; review ZenDB toolchain isolation." >&2
  exit 1
fi

# No source compiled by the application toolchain may import the incompatible
# library.  A future approved integration must move the owning actor and all
# of its dependencies to one compatible compiler, then replace this guard.
if rg -n --glob '*.mo' '(ZenDB|zendb)' "$repo_root/canisters"; then
  echo "Application sources import ZenDB across compiler boundaries." >&2
  exit 1
fi

if [[ "${1:-}" == "--guard-only" ]]; then
  echo "ZenDB split-toolchain import guard passed."
  exit 0
fi

source_dir="${M1_ZENDB_SOURCE_DIR:-}"
if [[ -z "$source_dir" ]]; then
  echo "Set M1_ZENDB_SOURCE_DIR to a clean local checkout of the pinned ZenDB source." >&2
  exit 2
fi
if [[ ! -d "$source_dir/.git" ]]; then
  echo "M1_ZENDB_SOURCE_DIR is not a Git checkout." >&2
  exit 2
fi
if [[ -n "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]]; then
  echo "ZenDB checkout has tracked modifications; refusing an unpinned probe." >&2
  exit 2
fi
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$expected_commit" ]] || {
  echo "ZenDB commit does not match the candidate pin." >&2
  exit 2
}
[[ "$(git -C "$source_dir" archive --format=tar HEAD | sha256sum | awk '{print $1}')" == "$expected_archive_sha256" ]] || {
  echo "ZenDB source archive hash does not match the candidate pin." >&2
  exit 2
}
[[ "$(sha256sum "$source_dir/mops.toml" | awk '{print $1}')" == "$expected_mops_toml_sha256" ]] || {
  echo "ZenDB mops.toml hash does not match the candidate pin." >&2
  exit 2
}
[[ "$(sha256sum "$source_dir/mops.lock" | awk '{print $1}')" == "$expected_mops_lock_sha256" ]] || {
  echo "ZenDB mops.lock hash does not match the candidate pin." >&2
  exit 2
}
grep -Fq "moc = \"${expected_zendb_moc}\"" "$source_dir/mops.toml" || {
  echo "ZenDB does not declare its isolated Motoko compiler pin." >&2
  exit 2
}

zendb_moc="$(cd "$source_dir" && mops toolchain bin moc)"
[[ "$(sha256sum "$zendb_moc" | awk '{print $1}')" == "$expected_zendb_moc_sha256" ]] || {
  echo "ZenDB Motoko compiler binary hash does not match the candidate pin." >&2
  exit 2
}

# This known failure is the evidence that merely splitting toolchains does not
# make the exact v2.0.1 dependency closure usable.  In particular,
# memory-collection@0.4.0 expects Nat.bytes from a different Core binding.
set +e
probe_output="$(cd "$source_dir" && mops check src/lib.mo 2>&1)"
probe_status=$?
set -e
if [[ $probe_status -eq 0 ]]; then
  echo "ZenDB unexpectedly compiled; review and replace the negative compatibility proof." >&2
  exit 1
fi
if ! grep -Fq "field bytes does not exist in module" <<<"$probe_output"; then
  echo "$probe_output" >&2
  echo "ZenDB probe failed for an unexpected reason." >&2
  exit 1
fi

echo "ZenDB v2.0.1 split-toolchain incompatibility reproduced under the exact pin."
