#!/usr/bin/env bash
set -euo pipefail

# Verifies the owner-directed, deliberately small M1 replacement for the
# released hex package. It is entirely local and never contacts a registry.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fork="$repo_root/packages/hex-m1-compat"

fail() {
  printf '%s\n' "hex M1 compatibility verification failed: $*" >&2
  exit 1
}

[[ -f "$fork/src/lib.mo" ]] || fail "missing compatibility package source"
grep -Fqx 'hex = "./packages/hex-m1-compat"' "$repo_root/mops.toml" || fail "root does not select the local package"
grep -Fqx 'hex = "../hex-m1-compat"' "$repo_root/packages/identify-m1-compat/mops.toml" || fail "identify does not select the local package"
grep -Fqx 'name = "hex-m1-compat"' "$fork/mops.toml" || fail "package name changed"
grep -Fqx 'version = "1.0.2-m1.1"' "$fork/mops.toml" || fail "package version changed"
grep -Fq '"hex": "./packages/hex-m1-compat",' "$repo_root/mops.lock" || fail "lock does not record the local package"

tree_hash() {
  (
    cd "$fork"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | LC_ALL=C sort | sha256sum | awk '{print $1}'
  )
}

[[ "$(sha256sum "$fork/mops.toml" | awk '{print $1}')" == "1bf48492fdfcb7eb143dbb79cb9092a13cec0b24993d79660da7bba42f78ecaf" ]] || fail "manifest hash changed"
[[ "$(sha256sum "$fork/src/lib.mo" | awk '{print $1}')" == "130c71999a5d2289c44d54e20f456131af574c9b13aaa2f79427c62d8805ea68" ]] || fail "source hash changed"
[[ "$(tree_hash)" == "139901b79c86bcaef0a920e7e4d08e8e48c187c212f4187b1e8de27d1ca4b4be" ]] || fail "package tree hash changed"

printf '%s\n' 'hex M1 compatibility package verification passed'
