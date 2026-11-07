#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { buildExport, commitment, decimalToAtoms, isoToNanoseconds } from './lib.mjs'

const [outputPath, sourceRevision] = process.argv.slice(2)
if (!outputPath || !sourceRevision || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... export-postgres.mjs OUTPUT_DIR SOURCE_REVISION')
  process.exit(2)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const snapshotAt = (await client.query('SELECT transaction_timestamp() AS snapshot_at')).rows[0].snapshot_at.toISOString()
  // Explicit reviewed allowlists only. Never replace these with SELECT *.
  const users = (await client.query(`
    SELECT id, name, "createdAt", "bannedTill", "isDeleted",
      "ethereumAddress", "solanaAddress", "bitcoinAddress", "bitcoinCashAddress",
      "polkadotAddress", "cosmosAddress", "stellarAddress", "icpAddress",
      "orcidId", "githubHandle", "bitbucketHandle", "gitlabHandle",
      "kycStatus", "kycVerifiedAt", "livelinessStatus", "livelinessVerifiedAt"
    FROM users ORDER BY id
  `)).rows
  const aiRows = (await client.query(`
    SELECT r."customId", r."resultKind", r.result, l."userId", s.ordinal, s.url
    FROM ai_results r
    LEFT JOIN openai_logs l ON l."customId" = r."customId"
    LEFT JOIN ai_result_sources s ON s."aiResultId" = r.id
    WHERE r.status = 'SUCCEEDED' AND l."userId" IS NOT NULL
    ORDER BY r."customId", s.ordinal
  `)).rows
  const distributions = (await client.query(`
    SELECT id, "userId", network, amount::text, "backlogAmount"::text, "amountUsd"::text,
      "distributionDate", status, "transactionHash", "tokenType", "tokenSymbol", "tokenAddress", "tokenDecimals"
    FROM gas_token_distributions ORDER BY id
  `)).rows
  const pendingTransactions = (await client.query(`
    SELECT id, "userId", network, amount::text, "backlogAmount"::text, "tokenType", "tokenSymbol",
      "tokenDecimals", status, "transactionHash", "executedTransactionHash", "createdAt", "updatedAt"
    FROM pending_transactions ORDER BY id
  `)).rows

  const addressColumns = [
    ['ethereum', 'ethereumAddress'], ['solana', 'solanaAddress'], ['bitcoin', 'bitcoinAddress'],
    ['bitcoin_cash', 'bitcoinCashAddress'], ['polkadot', 'polkadotAddress'], ['cosmos', 'cosmosAddress'],
    ['stellar', 'stellarAddress'], ['icp', 'icpAddress'],
  ]
  const identityColumns = [['orcid', 'orcidId'], ['github', 'githubHandle'], ['bitbucket', 'bitbucketHandle'], ['gitlab', 'gitlabHandle']]
  const groupedResults = new Map()
  for (const row of aiRows) {
    const entry = groupedResults.get(row.customId) ?? { row, sources: [] }
    if (row.url) entry.sources.push(row.url)
    groupedResults.set(row.customId, entry)
  }
  const snapshot = {
    profiles: users.map((user) => ({
      legacy_id: String(user.id), name: user.name, created_at_ns: isoToNanoseconds(user.createdAt),
      status: user.isDeleted ? { deleted: null } : user.bannedTill && user.bannedTill > new Date(snapshotAt) ? { banned: { until_ns: isoToNanoseconds(user.bannedTill) } } : { active: null },
    })),
    identities: users.flatMap((user) => identityColumns.flatMap(([kind, column]) => user[column] ? [{ legacy_user_id: String(user.id), kind, reference: user[column] }] : [])),
    eligibility: users.map((user) => {
      const status = user.kycStatus === 'VERIFIED' && user.livelinessStatus === 'VERIFIED' ? 'eligible' : 'unknown'
      const policyView = { legacy_user_id: String(user.id), status, kyc_verified_at: user.kycVerifiedAt?.toISOString() ?? null, liveliness_verified_at: user.livelinessVerifiedAt?.toISOString() ?? null }
      return { legacy_user_id: String(user.id), status, issuer: 'legacy-policy-export/v1', reference_hash: commitment('meritocracy/migration/eligibility/v1', policyView), expires_at: null }
    }),
    payouts: users.flatMap((user) => addressColumns.flatMap(([network, column]) => user[column] ? [{ legacy_user_id: String(user.id), network, asset: null, normalized_address: user[column] }] : [])),
    evaluations: [...groupedResults.values()].map(({ row, sources }) => ({
      legacy_user_id: String(row.userId), input_hash: commitment('meritocracy/migration/evaluation-input/v1', { custom_id: row.customId, result_kind: row.resultKind }),
      result_hash: commitment('meritocracy/migration/evaluation-result/v1', row.result), outcome: row.result,
      model_version: 'legacy-provider-hidden', prompt_version: commitment('meritocracy/migration/prompt-version/v1', row.resultKind),
      source_hashes: sources.map((url) => commitment('meritocracy/migration/source/v1', url)),
    })),
    distributions: distributions.map((row) => ({
      legacy_id: String(row.id), legacy_user_id: String(row.userId), allocation_id: String(row.id),
      atoms: decimalToAtoms(row.amount, row.tokenDecimals), fee_atoms: '0', network: row.network, asset: row.tokenSymbol,
      amount_usd_decimal: row.amountUsd, backlog_atoms: decimalToAtoms(row.backlogAmount, row.tokenDecimals), status: row.status,
      receipt_hash: row.transactionHash ? commitment('meritocracy/migration/receipt/v1', row.transactionHash) : null,
      token_type: row.tokenType, token_address_hash: row.tokenAddress ? commitment('meritocracy/migration/token-address/v1', row.tokenAddress) : null,
      token_decimals: row.tokenDecimals, occurred_at: row.distributionDate.toISOString(),
    })).concat(pendingTransactions.map((row) => ({
      legacy_id: `pending-${row.id}`, legacy_user_id: String(row.userId), allocation_id: `pending-${row.id}`,
      atoms: decimalToAtoms(row.amount, row.tokenDecimals), fee_atoms: '0', network: row.network, asset: row.tokenSymbol,
      backlog_atoms: decimalToAtoms(row.backlogAmount, row.tokenDecimals), status: row.status, token_type: row.tokenType,
      token_decimals: row.tokenDecimals, occurred_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
      request_commitment: commitment('meritocracy/migration/pending-request/v1', row.transactionHash),
      receipt_hash: row.executedTransactionHash ? commitment('meritocracy/migration/receipt/v1', row.executedTransactionHash) : null,
    }))),
  }
  const exported = buildExport(snapshot, { source_revision: sourceRevision, snapshot_at: snapshotAt })
  mkdirSync(resolve(outputPath), { recursive: true })
  for (const [name, content] of Object.entries(exported.files)) writeFileSync(resolve(outputPath, name), content, { flag: 'wx' })
  writeFileSync(resolve(outputPath, 'manifest.json'), exported.manifest_json, { flag: 'wx' })
  await client.query('COMMIT')
  console.log(exported.manifest.export_root)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await client.end()
}
