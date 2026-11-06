#!/usr/bin/env bash
set -euo pipefail

mops install --lock check
mops fmt --check
mops check -- -Werror
mops build -- -Werror
mops test unit-bootstrap --reporter compact
mops test registry --reporter compact
mops test replica-bootstrap --mode replica --replica pocket-ic --reporter compact
node --test test/registry-pocketic.test.mjs
node --test test/registry-payout-pocketic.test.mjs

for candid in icp/candid/v1/*.did; do
  didc check "$candid"
done

for fixture in icp/fixtures/v1/*.json; do
  jq -e . "$fixture" >/dev/null
done

npm run build --workspace frontend
git diff --check
