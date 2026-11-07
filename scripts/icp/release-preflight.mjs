#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Principal } from '@icp-sdk/core/principal'

const CANISTERS = ['frontend', 'registry', 'assessment', 'rounds', 'vault', 'audit']
const INTERFACES = ['registry', 'assessment', 'rounds', 'vault', 'audit']
const ROLES = ['governance', 'frontend_release', 'registry_policy', 'assessment_policy', 'rounds_manager', 'dispute_resolver', 'vault_pause', 'audit_appender']
const APPROVALS = ['security_review', 'governance', 'migration_review', 'treasury', 'incident_owner']
const HASH = /^[0-9a-f]{64}$/
const REVISION = /^[0-9a-f]{40}$/
const INTEGER = /^(0|[1-9][0-9]*)$/
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function principal(value, label) {
  if (typeof value !== 'string' || value.includes('REPLACE_')) throw new Error(`${label} is not configured`)
  let parsed
  try { parsed = Principal.fromText(value) } catch { throw new Error(`${label} is not a valid principal`) }
  if (parsed.isAnonymous()) throw new Error(`${label} cannot be anonymous`)
  return parsed.toText()
}

export function validateReleaseManifest(manifest, { root = process.cwd(), currentRevision } = {}) {
  if (manifest?.schema !== 'meritocracy-icp-release/v1') throw new Error('Unsupported release manifest schema')
  if (!REVISION.test(manifest.source_revision ?? '')) throw new Error('source_revision must be a 40-character lowercase Git revision')
  if (currentRevision && manifest.source_revision !== currentRevision) throw new Error('source_revision does not match the checked-out revision')
  if (!HASH.test(manifest.migration_export_root ?? '')) throw new Error('migration_export_root must be a 32-byte lowercase hex digest')

  const canisters = Object.fromEntries(CANISTERS.map((name) => [name, principal(manifest.canisters?.[name], `canisters.${name}`)]))
  if (new Set(Object.values(canisters)).size !== CANISTERS.length) throw new Error('Every canister must have a distinct principal')

  for (const name of INTERFACES) {
    const expected = manifest.interfaces?.[name]
    if (!HASH.test(expected ?? '')) throw new Error(`interfaces.${name} must be a lowercase SHA-256 digest`)
    const actual = sha256(readFileSync(`${root}/icp/candid/v1/${name}.did`))
    if (actual !== expected) throw new Error(`interfaces.${name} does not match canonical Candid`)
    if (!SEMVER.test(manifest.interface_versions?.[name] ?? '')) throw new Error(`interface_versions.${name} must be semantic major.minor.patch`)
  }

  const roles = Object.fromEntries(ROLES.map((name) => [name, principal(manifest.roles?.[name], `roles.${name}`)]))
  if (roles.governance === roles.frontend_release || roles.governance === roles.vault_pause) throw new Error('governance must be separated from frontend release and vault pause roles')
  if (roles.rounds_manager === roles.dispute_resolver) throw new Error('rounds manager and dispute resolver must be separate roles')

  if (!Array.isArray(manifest.ledgers) || manifest.ledgers.length === 0) throw new Error('At least one reviewed ICRC-1 ledger is required')
  const ledgers = new Set()
  for (const [index, ledger] of manifest.ledgers.entries()) {
    const id = principal(ledger.principal, `ledgers[${index}].principal`)
    if (ledgers.has(id)) throw new Error(`Duplicate ledger principal ${id}`)
    ledgers.add(id)
    if (ledger.standard !== 'ICRC-1') throw new Error(`ledgers[${index}] must use ICRC-1`)
    if (!/^[A-Z0-9]{2,12}$/.test(ledger.symbol ?? '')) throw new Error(`ledgers[${index}] has an invalid symbol`)
    if (!Number.isInteger(ledger.decimals) || ledger.decimals < 0 || ledger.decimals > 255) throw new Error(`ledgers[${index}] has invalid decimals`)
    if (!INTEGER.test(ledger.canary_cap_atoms ?? '') || BigInt(ledger.canary_cap_atoms) === 0n) throw new Error(`ledgers[${index}] needs a positive exact canary cap`)
  }

  if (!Array.isArray(manifest.shadow_rounds) || manifest.shadow_rounds.length !== 3 || new Set(manifest.shadow_rounds.map(String)).size !== 3 || manifest.shadow_rounds.some((id) => !/^[1-9][0-9]*$/.test(String(id)))) throw new Error('Exactly three distinct positive shadow round IDs are required')
  const approvers = new Set()
  for (const approval of APPROVALS) {
    const record = manifest.approvals?.[approval]
    if (record?.approved !== true) throw new Error(`Approval ${approval} is missing`)
    approvers.add(principal(record.approver, `approvals.${approval}.approver`))
    if (!HASH.test(record.evidence_hash ?? '')) throw new Error(`Approval ${approval} needs an evidence hash`)
  }
  if (approvers.size < 3) throw new Error('Release approvals require at least three distinct approver principals')
  return { canisters, roles }
}

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) throw new Error(`${name} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

export function onlineReadOnlyChecks(manifest, network) {
  for (const name of CANISTERS) command('dfx', ['canister', '--network', network, 'info', manifest.canisters[name]])
  for (const name of INTERFACES) {
    const raw = command('dfx', ['canister', '--network', network, 'call', manifest.canisters[name], 'interface_version', '--query', '--output', 'json'])
    const response = JSON.parse(raw)
    const version = Array.isArray(response) ? response[0] : response
    if (!version || typeof version !== 'object') throw new Error(`${name} returned an invalid interface_version`)
    const actualVersion = [version.major, version.minor, version.patch].map(String).join('.')
    if (actualVersion !== manifest.interface_versions[name]) throw new Error(`${name} interface version is ${actualVersion}, expected ${manifest.interface_versions[name]}`)
    const bytes = version.schema_hash
    if (!Array.isArray(bytes) || bytes.some((byte) => !Number.isInteger(Number(byte)) || Number(byte) < 0 || Number(byte) > 255)) throw new Error(`${name} returned an invalid schema hash`)
    const actualHash = bytes.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('')
    if (actualHash !== manifest.interfaces[name]) throw new Error(`${name} on-chain schema hash does not match the release manifest`)
  }
}

function gitRevision(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Cannot resolve Git revision')
  return result.stdout.trim()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const online = args.includes('--online')
  const networkIndex = args.indexOf('--network')
  const network = networkIndex >= 0 ? args[networkIndex + 1] : 'ic'
  const manifestPath = args.find((value, index) => !value.startsWith('--') && index !== networkIndex + 1)
  if (!manifestPath) {
    console.error('usage: release-preflight.mjs MANIFEST [--online --network ic]')
    process.exit(2)
  }
  const root = process.cwd()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  validateReleaseManifest(manifest, { root, currentRevision: gitRevision(root) })
  if (online) onlineReadOnlyChecks(manifest, network)
  console.log(`release preflight passed${online ? ` with read-only ${network} checks` : ''}`)
}
