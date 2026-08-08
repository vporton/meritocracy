#!/usr/bin/env bash
# Prove that both the exact ZenDB pin and the application use Motoko 1.4.1
# for the embedded-library compiler fixture. It is local-only and delegates
# all source/lock verification to the probe; it never permits a dual compiler.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
probe="$repo_root/scripts/icp/test-zendb-embedded-storage.sh"

[[ -x "$probe" ]] || {
  echo "Missing executable embedded ZenDB probe: $probe" >&2
  exit 1
}
[[ -n "${M1_ZENDB_SOURCE_DIR:-}" ]] || {
  echo "M1_ZENDB_SOURCE_DIR must name an existing, resolved ZenDB checkout" >&2
  exit 1
}

# This first command is an immutable provenance/compiler-control check.
"$probe" --compiler=zendb

"$probe" --compiler=repository

echo "ZenDB v2.0.1 and the repository toolchain both compile the embedded fixture with Motoko 1.4.1."
