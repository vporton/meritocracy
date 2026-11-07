import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assertNoForbiddenFields, auditEventId, buildExport, canonicalJson, decimalToAtoms, isoToNanoseconds,
  reconcileShadow, signReport, updateEvidenceLedger, verifySignedReport,
} from '../scripts/icp/migration/lib.mjs'

const fixture = JSON.parse(readFileSync(new URL('fixtures/migration-snapshot.json', import.meta.url)))

test('export is deterministic, exact and rejects forbidden fields', () => {
  const metadata = { source_revision: 'legacy-abc', snapshot_at: '2026-11-07T00:00:00.000Z' }
  const first = buildExport(fixture, metadata)
  const second = buildExport(structuredClone(fixture), metadata)
  assert.deepEqual(first, second)
  assert.equal(first.manifest.files.reduce((sum, file) => sum + file.rows, 0), 6)
  assert.match(first.manifest.export_root, /^[0-9a-f]{64}$/)
  assert.match(first.files['distributions.jsonl'], /"atoms":"300000000"/)
  assert.match(first.files['payout-candidates.jsonl'], /"active":false/)
  assert.throws(() => assertNoForbiddenFields({ oauth_access_token: 'must-not-export' }), /Forbidden migration field/)
  assert.throws(() => assertNoForbiddenFields({ systemSecret: 'must-not-export' }), /Forbidden migration field/)
  assert.throws(() => assertNoForbiddenFields({ rawProviderResponse: 'must-not-export' }), /Forbidden migration field/)
  assert.throws(() => canonicalJson({ atoms: Number.MAX_SAFE_INTEGER + 1 }), /Unsafe numeric/)
  assert.equal(auditEventId({ namespace: 'legacy', table: 'users', legacy_row_id: 7, export_root: first.manifest.export_root }), auditEventId({ namespace: 'legacy', table: 'users', legacy_row_id: '7', export_root: first.manifest.export_root }))
  assert.equal(decimalToAtoms('1.23000000', 8), '123000000')
  assert.equal(decimalToAtoms('0.00000001', 8), '1')
  assert.throws(() => decimalToAtoms('0.000000001', 8), /more than 8/)
  assert.throws(() => decimalToAtoms('-1', 8), /Invalid non-negative/)
  assert.equal(isoToNanoseconds('2026-01-01T00:00:00.000Z'), '1767225600000000000')
  assert.match(first.files['profiles.jsonl'], /"created_at_ns":"1767225600000000000"/)
})

const baseShadow = {
  mappings: [{ legacy_user_id: '7', icp_user_id: '1' }],
  eligibility: [{ legacy_user_id: '7', status: 'eligible', reference_hash: 'aa' }],
  evaluations: [{ legacy_user_id: '7', weight_numerator: '3', weight_denominator: '2', outcome: 'accepted' }],
  allocations: [{ allocation_id: '101', user_id: '1', atoms: '300000000' }],
  routes: [{ allocation_id: '101', network: 'icp', asset: 'ICP', normalized_address: 'aaaaa-aa' }],
  carried: [],
  transfers: [{ allocation_id: '101', memo: 'ff', block_index: '987', fee_atoms: '10000' }],
  vault: { round_id: '11', reserved_atoms: '0', ledger_atoms: '0' },
}

test('shadow reconciliation classifies fixed categories and fails unexplained differences', () => {
  const equal = reconcileShadow(baseShadow, structuredClone(baseShadow))
  assert.equal(equal.passed, true)
  assert.equal(equal.counts.unexplained, 0)
  const changed = structuredClone(baseShadow)
  changed.allocations[0].user_id = '9'
  changed.vault.ledger_atoms = '1'
  const failed = reconcileShadow(baseShadow, changed)
  assert.equal(failed.passed, false)
  assert.equal(failed.counts.unexplained, 2)
  const unsupportedLegacy = structuredClone(baseShadow)
  unsupportedLegacy.routes[0].network = 'ethereum'
  const noIcpRoute = structuredClone(baseShadow)
  noIcpRoute.routes = []
  assert.equal(reconcileShadow(unsupportedLegacy, noIcpRoute).counts.unsupported_stage9_route, 1)
})

test('signed evidence ledger requires three unchanged reconciled rounds and resets', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const base = {
    export_root: 'ab'.repeat(32), legacy_revision: 'legacy-abc', icp_revision: 'icp-def',
    canisters: { registry: 'aaaaa-aa' }, interfaces: { registry: '12'.repeat(32) },
    asset: 'ICP', ledger: 'ryjl3-tyaaa-aaaaa-aaaba-cai', diff_counts: { unexplained: 0 },
    ledger_reconciled: true, reviewer_approved: true,
  }
  let ledger = { schema: 'meritocracy-reconciliation-ledger/v1', entries: [], ready_for_treasury_migration: false }
  for (let round = 1; round <= 3; round += 1) {
    const signed = signReport({ ...base, round_id: String(round) }, privateKey)
    assert.equal(verifySignedReport(signed, publicKey), true)
    ledger = updateEvidenceLedger(ledger, signed, publicKey)
  }
  assert.equal(ledger.ready_for_treasury_migration, true)
  const changed = signReport({ ...base, round_id: '4', icp_revision: 'changed' }, privateKey)
  ledger = updateEvidenceLedger(ledger, changed, publicKey)
  assert.equal(ledger.entries.at(-1).consecutive, 1)
  assert.equal(ledger.ready_for_treasury_migration, false)
  const mismatch = signReport({ ...base, round_id: '5', diff_counts: { unexplained: 1 } }, privateKey)
  ledger = updateEvidenceLedger(ledger, mismatch, publicKey)
  assert.equal(ledger.entries.at(-1).consecutive, 0)
  const forged = { ...mismatch, signature: Buffer.from('forged').toString('base64') }
  assert.throws(() => updateEvidenceLedger(ledger, forged, publicKey), /Invalid reconciliation report signature/)
})
