#!/usr/bin/env bash
set -euo pipefail

# Verifies the deliberately narrow, owner-approved M1 compatibility fork of
# identify@0.0.2. It does not contact a provider, registry, or network.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fork="$repo_root/packages/identify-m1-compat"

fail() {
  printf '%s\n' "identify M1 compatibility verification failed: $*" >&2
  exit 1
}

[[ -f "$fork/src/lib.mo" ]] || fail "missing compatibility fork"
[[ ! -e "$fork/src/frontend" ]] || fail "frontend E2E fixtures must not be packaged"

grep -Fqx 'identify = "./packages/identify-m1-compat"' "$repo_root/mops.toml" || fail "root does not use the local fork"
grep -Fqx '"core@1" = "1.0.0"' "$fork/mops.toml" || fail "fork does not pin Core 1 explicitly"
grep -Fqx 'name = "identify-m1-compat"' "$fork/mops.toml" || fail "fork manifest name changed"
grep -Fqx 'version = "0.0.2-m1.1"' "$fork/mops.toml" || fail "fork manifest version changed"
grep -Fq '"identify": "./packages/identify-m1-compat",' "$repo_root/mops.lock" || fail "lock does not record the local fork"

[[ "$(rg -o '"mo:core@1/' "$fork/src/backend" | wc -l | tr -d ' ')" == "103" ]] || fail "expected 103 explicit Core 1 imports"
if rg -q '"mo:core/' "$fork/src/backend"; then
  fail "fork retains an unqualified Core import"
fi

tree_hash() {
  local relative="${1#"$repo_root/"}"
  (
    cd "$repo_root"
    find "$relative" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | LC_ALL=C sort | sha256sum | awk '{print $1}'
  )
}

normalized_source_hash() {
  (
    cd "$repo_root"
    find packages/identify-m1-compat/src -type f -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' file; do
      relative="${file#packages/identify-m1-compat/src/}"
      if [[ "$relative" == backend/*.mo ]]; then
        sed 's#"mo:core@1/#"mo:core/#g' "$file" | sha256sum | awk -v path="$relative" '{print $1 "  " path}'
      else
        sha256sum "$file" | awk -v path="$relative" '{print $1 "  " path}'
      fi
    done | LC_ALL=C sort | sha256sum | awk '{print $1}'
  )
}

[[ "$(sha256sum "$fork/mops.toml" | awk '{print $1}')" == "55fd2127e80aff5f5d36746e85cf503a609bdd94b56b3dcf18d643c3f0e13e35" ]] || fail "fork manifest hash changed"
[[ "$(sha256sum "$fork/src/lib.mo" | awk '{print $1}')" == "22fb166b9036d47df24f4ed4e3245415648b802f229789eb4ea19c45eb83a88f" ]] || fail "public API entry hash changed"
[[ "$(tree_hash "$fork/src")" == "afbbb093f50dcffbe1c789678c5f7b56c15fc0feb5850e13cc575e0ad4e8672d" ]] || fail "fork source-tree hash changed"
[[ "$(normalized_source_hash)" == "23260cda1aa97886bc63e77bbcc3fa906f5d65b8e2f3d899408adaa98bf2f93c" ]] || fail "fork exceeds the approved upstream-source delta"
[[ "$(tree_hash "$fork")" == "eeab90a411e5f13ee0cfef869f79ba4a42a2e8f0001aa24c84e9a3f0d07f97cc" ]] || fail "fork package-tree hash changed"

printf '%s\n' 'identify M1 compatibility fork verification passed'
