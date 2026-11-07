import { createHash, sign, verify } from 'node:crypto'

export const DIFF_CATEGORIES = Object.freeze([
  'equal',
  'expected_policy_difference',
  'expected_rounding_difference',
  'missing_mapping',
  'unsupported_stage9_route',
  'unexplained',
])

const forbiddenFragments = [
  'password', 'secret', 'token', 'oauth', 'kyc', 'liveness', 'personalnumber',
  'privatekey', 'rawrequest', 'rawresponse', 'rawtransaction', 'storeid',
  'providerrequest', 'providerresponse',
]

export function assertNoForbiddenFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (forbiddenFragments.some((fragment) => normalizedKey.includes(fragment))) throw new Error(`Forbidden migration field at ${path}.${key}`)
    assertNoForbiddenFields(child, `${path}.${key}`)
  }
}

export function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString(10)
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe numeric value in migration data')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export const canonicalJson = (value) => `${JSON.stringify(canonicalize(value))}\n`
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const commitment = (domain, value) => sha256(`${domain}\0${canonicalJson(value)}`)

export function decimalToAtoms(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals')
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(String(value))
  if (!match) throw new Error(`Invalid non-negative decimal amount: ${value}`)
  const fraction = match[2] ?? ''
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error(`Amount has more than ${decimals} fractional digits`)
  const padded = fraction.slice(0, decimals).padEnd(decimals, '0')
  return (BigInt(match[1]) * (10n ** BigInt(decimals)) + BigInt(padded || '0')).toString(10)
}

export function isoToNanoseconds(value) {
  const normalized = value instanceof Date ? value.toISOString() : String(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) throw new Error(`Timestamp must be canonical millisecond ISO-8601: ${normalized}`)
  const milliseconds = Date.parse(normalized)
  if (!Number.isSafeInteger(milliseconds)) throw new Error('Timestamp is outside the exact JavaScript millisecond range')
  return (BigInt(milliseconds) * 1_000_000n).toString(10)
}

const sorted = (rows, key = 'legacy_id') => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]), 'en'))

export function buildExport(snapshot, metadata) {
  assertNoForbiddenFields(snapshot)
  const files = {
    'profiles.jsonl': sorted(snapshot.profiles).map((row) => canonicalJson({
      legacy_id: String(row.legacy_id),
      name: row.name ?? null,
      created_at_ns: row.created_at_ns ?? isoToNanoseconds(row.created_at),
      status: row.status,
    })).join(''),
    'identity-commitments.jsonl': sorted(snapshot.identities, 'legacy_user_id').map((row) => canonicalJson({
      legacy_user_id: String(row.legacy_user_id),
      kind: row.kind,
      reference_hash: commitment('meritocracy/migration/identity/v1', row.reference),
      reauthentication_required: true,
    })).join(''),
    'eligibility.jsonl': sorted(snapshot.eligibility, 'legacy_user_id').map((row) => canonicalJson({
      legacy_user_id: String(row.legacy_user_id),
      status: row.status,
      issuer: row.issuer,
      reference_hash: row.reference_hash,
      expires_at: row.expires_at ?? null,
    })).join(''),
    'payout-candidates.jsonl': sorted(snapshot.payouts, 'legacy_user_id').map((row) => canonicalJson({
      legacy_user_id: String(row.legacy_user_id),
      network: row.network,
      asset: row.asset ?? null,
      normalized_address: row.normalized_address,
      verification: 'legacy_imported',
      active: false,
    })).join(''),
    'evaluations.jsonl': sorted(snapshot.evaluations, 'legacy_user_id').map((row) => canonicalJson({
      legacy_user_id: String(row.legacy_user_id),
      input_hash: row.input_hash,
      result_hash: row.result_hash,
      outcome: row.outcome,
      model_version: row.model_version,
      prompt_version: row.prompt_version,
      source_hashes: [...row.source_hashes].sort(),
    })).join(''),
    'distributions.jsonl': sorted(snapshot.distributions).map((row) => canonicalJson({ ...row, legacy_id: String(row.legacy_id), atoms: String(row.atoms), fee_atoms: String(row.fee_atoms ?? '0') })).join(''),
  }
  const fileEntries = Object.entries(files).sort().map(([name, content]) => ({
    name,
    rows: content === '' ? 0 : content.trimEnd().split('\n').length,
    sha256: sha256(content),
  }))
  const manifestBase = canonicalize({
    schema: 'meritocracy-legacy-export/v1',
    source_revision: metadata.source_revision,
    snapshot_at: metadata.snapshot_at,
    transaction: { isolation: 'repeatable read', read_only: true },
    files: fileEntries,
  })
  const exportRoot = commitment('meritocracy/migration/export-root/v1', manifestBase)
  const manifest = { ...manifestBase, export_root: exportRoot }
  return { files, manifest, manifest_json: canonicalJson(manifest) }
}

export function auditEventId({ namespace, table, legacy_row_id, export_root }) {
  return commitment('meritocracy/migration/audit-event/v1', {
    namespace,
    table,
    legacy_row_id: String(legacy_row_id),
    export_root,
  })
}

const indexBy = (rows, field) => new Map(rows.map((row) => [String(row[field]), row]))
const same = (left, right) => canonicalJson(left) === canonicalJson(right)

export function reconcileShadow(legacy, icp) {
  const differences = []
  const compare = (kind, legacyRows, icpRows, key, fields, classify = () => 'unexplained') => {
    const right = indexBy(icpRows, key)
    for (const leftRow of legacyRows) {
      const id = String(leftRow[key])
      const rightRow = right.get(id)
      if (!rightRow) {
        differences.push({ kind, id, category: kind === 'mapping' ? 'missing_mapping' : classify(leftRow, null), fields: ['missing'] })
        continue
      }
      const changed = fields.filter((field) => !same(leftRow[field], rightRow[field]))
      differences.push({ kind, id, category: changed.length === 0 ? 'equal' : classify(leftRow, rightRow, changed), fields: changed })
      right.delete(id)
    }
    for (const id of right.keys()) differences.push({ kind, id, category: 'unexplained', fields: ['unexpected'] })
  }

  compare('mapping', legacy.mappings, icp.mappings, 'legacy_user_id', ['icp_user_id'])
  compare('eligibility', legacy.eligibility, icp.eligibility, 'legacy_user_id', ['status', 'reference_hash'], (_l, _r, fields) => fields?.length === 1 && fields[0] === 'reference_hash' ? 'expected_policy_difference' : 'unexplained')
  compare('evaluation', legacy.evaluations, icp.evaluations, 'legacy_user_id', ['weight_numerator', 'weight_denominator', 'outcome'])
  compare('allocation', legacy.allocations, icp.allocations, 'allocation_id', ['user_id', 'atoms'], (left, right, fields) => fields?.length === 1 && fields[0] === 'atoms' && right && (BigInt(left.atoms) - BigInt(right.atoms) <= 1n && BigInt(right.atoms) - BigInt(left.atoms) <= 1n) ? 'expected_rounding_difference' : 'unexplained')
  compare('route', legacy.routes, icp.routes, 'allocation_id', ['network', 'asset', 'normalized_address'], (left) => left.network !== 'icp' ? 'unsupported_stage9_route' : 'unexplained')
  compare('carried', legacy.carried, icp.carried, 'allocation_id', ['atoms', 'reason'])
  compare('transfer', legacy.transfers, icp.transfers, 'allocation_id', ['memo', 'block_index', 'fee_atoms'])
  differences.push({
    kind: 'vault', id: String(icp.vault.round_id),
    category: String(icp.vault.reserved_atoms) === String(icp.vault.ledger_atoms) ? 'equal' : 'unexplained',
    fields: String(icp.vault.reserved_atoms) === String(icp.vault.ledger_atoms) ? [] : ['reserved_atoms', 'ledger_atoms'],
  })
  const counts = Object.fromEntries(DIFF_CATEGORIES.map((category) => [category, differences.filter((item) => item.category === category).length]))
  return { schema: 'meritocracy-shadow-reconciliation/v1', differences, counts, passed: counts.unexplained === 0 }
}

export function signReport(report, privateKey) {
  const payload = Buffer.from(canonicalJson(report))
  return { report: canonicalize(report), signature: sign(null, payload, privateKey).toString('base64') }
}

export function verifySignedReport(signed, publicKey) {
  return verify(null, Buffer.from(canonicalJson(signed.report)), publicKey, Buffer.from(signed.signature, 'base64'))
}

export function updateEvidenceLedger(ledger, signedReport, publicKey) {
  if (!publicKey || !verifySignedReport(signedReport, publicKey)) throw new Error('Invalid reconciliation report signature')
  const report = signedReport.report
  const context = commitment('meritocracy/migration/reconciliation-context/v1', {
    export_root: report.export_root,
    legacy_revision: report.legacy_revision,
    icp_revision: report.icp_revision,
    canisters: report.canisters,
    interfaces: report.interfaces,
    asset: report.asset,
    ledger: report.ledger,
  })
  const unexplained = Number(report.diff_counts?.unexplained ?? 0)
  const reconciled = report.ledger_reconciled === true && unexplained === 0 && report.reviewer_approved === true
  const prior = ledger.entries.at(-1)
  const consecutive = reconciled && prior?.context === context ? prior.consecutive + 1 : reconciled ? 1 : 0
  const entry = {
    round_id: String(report.round_id), context, report_hash: sha256(canonicalJson(signedReport.report)),
    signature: signedReport.signature, reconciled, consecutive,
  }
  return { schema: 'meritocracy-reconciliation-ledger/v1', entries: [...ledger.entries, entry], ready_for_treasury_migration: consecutive >= 3 }
}
