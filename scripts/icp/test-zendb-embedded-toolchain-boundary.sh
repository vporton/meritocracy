#!/usr/bin/env bash
# Prove that the embedded ZenDB v2.0.1 compiler-only fixture cannot be
# silently treated as compatible with the repository's pinned Motoko compiler.
# It is local-only and delegates all source/lock verification to the probe.
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

# This first command is an immutable provenance/compiler-control check. It
# does not authorize a second toolchain for application canisters.
"$probe" --compiler=zendb

failure_log="$(mktemp /tmp/meritocracy-zendb-repository-moc.XXXXXXXX.log)"
cleanup() {
  rm -f -- "$failure_log"
}
trap cleanup EXIT

set +e
"$probe" --compiler=repository >"$failure_log" 2>&1
repository_status=$?
set -e

# A pass would be new compatibility evidence and must be reviewed before this
# negative fixture can be changed. Do not turn it into an implicit approval.
if [[ "$repository_status" -eq 0 ]]; then
  cat "$failure_log" >&2
  echo "Repository Motoko compiler unexpectedly accepted ZenDB v2.0.1; record a new compatibility decision before changing this test." >&2
  exit 1
fi

# Pin the observed incompatibility rather than accepting an unrelated setup or
# source-verification failure as evidence about compiler compatibility.
grep -Fq "core@2.4.0" "$failure_log"
grep -Fq "Float32" "$failure_log"

echo "ZenDB v2.0.1 remains incompatible with repository Motoko 0.16.3; the embedded candidate is not an approved dependency."
