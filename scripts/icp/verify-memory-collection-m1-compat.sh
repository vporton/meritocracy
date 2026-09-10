#!/usr/bin/env bash
set -euo pipefail

# Verifies the deliberately minimal M1 compatibility fork of released
# memory-collection@0.4.0. It is local-only and never contacts a registry.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fork="$repo_root/packages/memory-collection-m1-compat"
released="$repo_root/.mops/memory-collection@0.4.0"

fail() {
  printf '%s\n' "memory-collection M1 compatibility verification failed: $*" >&2
  exit 1
}

[[ -d "$released" ]] || fail "missing released source closure"
[[ -f "$fork/src/MemoryBTree/Base.mo" ]] || fail "missing compatibility source"
grep -Fqx '"memory-collection@0.4" = "./packages/memory-collection-m1-compat"' "$repo_root/mops.toml" || fail "root does not select the local package"
grep -Fqx 'name = "memory-collection-m1-compat"' "$fork/mops.toml" || fail "package name changed"
grep -Fqx 'version = "0.4.0-m1.1"' "$fork/mops.toml" || fail "package version changed"
grep -Fq '"memory-collection@0.4": "./packages/memory-collection-m1-compat"' "$repo_root/mops.lock" || fail "lock does not record the local package"

changed_files="$(diff -qr "$released" "$fork" | sed -E 's#Files .*/memory-collection@0\.4\.0/(.*) and .*/memory-collection-m1-compat/.* differ#\1#; s#Only in .*##' || true)"
[[ "$changed_files" == $'mops.toml\nsrc/MemoryBTree/Base.mo' ]] || fail "fork changed files outside the approved manifest and Base alias"

[[ "$(sha256sum "$fork/mops.toml" | awk '{print $1}')" == "f8cd8ac1c6d5f6f9f5745def6f18bedd1856a924d17546eb90f75fdba1cd5546" ]] || fail "manifest hash changed"
[[ "$(sha256sum "$fork/src/MemoryBTree/Base.mo" | awk '{print $1}')" == "6446a60ca79b7c7588ee0a9167d54fcfa948fd17a1654d8bf9d70a81d9fef9a3" ]] || fail "Base source hash changed"

printf '%s\n' 'memory-collection M1 compatibility package verification passed'
