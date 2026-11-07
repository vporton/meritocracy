import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateReleaseManifest } from '../scripts/icp/release-preflight.mjs'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const digest = (name) => createHash('sha256').update(readFileSync(`${root}/icp/candid/v1/${name}.did`)).digest('hex')
const principals = ['rrkah-fqaaa-aaaaa-aaaaq-cai', 'ryjl3-tyaaa-aaaaa-aaaba-cai', 'r7inp-6aaaa-aaaaa-aaabq-cai', 'rkp4c-7iaaa-aaaaa-aaaca-cai', 'rno2w-sqaaa-aaaaa-aaacq-cai', 'rdmx6-jaaaa-aaaaa-aaadq-cai']
const roleIds = ['2ibo7-dia', 'renrk-eyaaa-aaaaa-aaada-cai', 'qoctq-giaaa-aaaaa-aaaea-cai', 'qaa6y-5yaaa-aaaaa-aaafa-cai', 'qjdve-lqaaa-aaaaa-aaaeq-cai', 'qsgjb-riaaa-aaaaa-aaaga-cai', 'qvhpv-4qaaa-aaaaa-aaagq-cai', 'q4eej-kyaaa-aaaaa-aaaha-cai']

function validManifest() {
  return {
    schema: 'meritocracy-icp-release/v1', source_revision: 'ab'.repeat(20), migration_export_root: 'cd'.repeat(32),
    canisters: Object.fromEntries(['frontend', 'registry', 'assessment', 'rounds', 'vault', 'audit'].map((name, index) => [name, principals[index]])),
    interfaces: Object.fromEntries(['registry', 'assessment', 'rounds', 'vault', 'audit'].map((name) => [name, digest(name)])),
    interface_versions: { registry: '1.4.0', assessment: '1.2.0', rounds: '1.2.0', vault: '1.1.0', audit: '1.1.0' },
    roles: Object.fromEntries(['governance', 'frontend_release', 'registry_policy', 'assessment_policy', 'rounds_manager', 'dispute_resolver', 'vault_pause', 'audit_appender'].map((name, index) => [name, roleIds[index]])),
    ledgers: [{ principal: 'ryjl3-tyaaa-aaaaa-aaaba-cai', symbol: 'ICP', decimals: 8, standard: 'ICRC-1', canary_cap_atoms: '1000000' }],
    shadow_rounds: ['1', '2', '3'],
    approvals: Object.fromEntries(['security_review', 'governance', 'migration_review', 'treasury', 'incident_owner'].map((name, index) => [name, { approved: true, approver: roleIds[index], evidence_hash: 'ef'.repeat(32) }])),
  }
}

test('release preflight validates exact artifacts and governance separation', () => {
  assert.doesNotThrow(() => validateReleaseManifest(validManifest(), { root, currentRevision: 'ab'.repeat(20) }))
  const wrong = validManifest(); wrong.interfaces.vault = '00'.repeat(32)
  assert.throws(() => validateReleaseManifest(wrong, { root }), /vault does not match/)
  const roles = validManifest(); roles.roles.dispute_resolver = roles.roles.rounds_manager
  assert.throws(() => validateReleaseManifest(roles, { root }), /must be separate/)
  const approval = validManifest(); approval.approvals.treasury.approved = false
  assert.throws(() => validateReleaseManifest(approval, { root }), /Approval treasury/)
  const placeholder = validManifest(); placeholder.canisters.vault = 'REPLACE_WITH_PRINCIPAL'
  assert.throws(() => validateReleaseManifest(placeholder, { root }), /not configured/)
})
