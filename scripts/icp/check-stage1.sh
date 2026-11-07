#!/usr/bin/env bash
set -euo pipefail

mops install --lock check
mops fmt --check
mops check -- -Werror
mops build -- -Werror
moc --package base .mops/base@0.16.0/src -o .mops/.build/mock-icrc1-ledger.wasm test/fixtures/mock-icrc1-ledger.mo
moc --package base .mops/base@0.16.0/src -o .mops/.build/mock-rounds.wasm test/fixtures/mock-rounds.mo
mops test unit-bootstrap --reporter compact
mops test registry-state-unit --reporter compact
mops test registry-safe-oauth --reporter compact
mops test registry-ethereum-auth --reporter compact
mops test registry-attestation --reporter compact
mops test registry-icrc-account --reporter compact
mops test vault-serialization --reporter compact
mops test vault-icrc1 --reporter compact
mops test vault-state-unit --reporter compact
mops test replica-bootstrap --mode replica --replica pocket-ic --reporter compact
node --test test/registry-pocketic.test.mjs
node --test test/registry-oauth-pocketic.test.mjs
node --test test/registry-attestation-pocketic.test.mjs
node --test test/registry-payout-pocketic.test.mjs
node --test test/vault-pocketic.test.mjs

for candid in icp/candid/v1/*.did; do
  didc check "$candid"
done

for fixture in icp/fixtures/v1/*.json; do
  jq -e . "$fixture" >/dev/null
done

npm run build --workspace frontend
git diff --check
