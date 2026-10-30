#!/usr/bin/env node
'use strict';

// This command deliberately has no DDL, replication, or data-export path.  It
// writes only aggregate/catalog facts and a column-name based redaction plan.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MAX_TABLES = 256;
const SENSITIVE_COLUMN = /(password|secret|token|bearer|credential|private.?key|mnemonic|seed|verification|kyc.*data|liveliness.*data|personal.?number|session)/i;

function redactionDisposition(columnName) {
  return SENSITIVE_COLUMN.test(columnName) ? 'EXCLUDE_RAW_VALUE; approved digest/metadata only' : 'REVIEW_FOR_EXPLICIT_PROJECTION';
}

function parseArguments(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex !== 0 || !argv[outputIndex + 1] || argv.length !== 2) {
    throw new Error('Usage: npm run inventory:postgres --workspace backend -- --output /secure/operator-only/m1-inventory.json');
  }
  const output = path.resolve(argv[outputIndex + 1]);
  if (output.endsWith(path.sep) || path.basename(output) === '.') throw new Error('Output must be a JSON file path');
  return output;
}

function safeError(error) {
  // Never serialize connection strings, server messages, query text, or row data.
  return `inventory failed (${error && error.code ? String(error.code) : 'unknown'})`;
}

async function query(client, text, values = []) {
  return (await client.query(text, values)).rows;
}

async function buildInventory(client) {
  const settings = await query(client, `
    SELECT name, setting
    FROM pg_settings
    WHERE name = ANY($1::text[])
    ORDER BY name`, [[
      'server_version_num', 'wal_level', 'max_replication_slots', 'max_wal_senders',
      'max_wal_size', 'min_wal_size', 'max_prepared_transactions', 'wal_keep_size',
    ]]);
  const tables = await query(client, `
    SELECT n.nspname AS schema, c.relname AS table, c.relreplident AS replica_identity,
      pg_total_relation_size(c.oid)::text AS total_bytes,
      COALESCE(i.index_name, '') AS replica_identity_index
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL (
      SELECT ci.relname AS index_name
      FROM pg_index pi JOIN pg_class ci ON ci.oid = pi.indexrelid
      WHERE pi.indrelid = c.oid AND pi.indisreplident
      LIMIT 1
    ) i ON true
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname
    LIMIT $1`, [MAX_TABLES + 1]);
  if (tables.length > MAX_TABLES) throw new Error('table-cap-exceeded');
  const columns = await query(client, `
    SELECT table_schema AS schema, table_name AS table, column_name AS column,
      data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position
    LIMIT $1`, [MAX_TABLES * 128 + 1]);
  if (columns.length > MAX_TABLES * 128) throw new Error('column-cap-exceeded');
  const [prepared, slots, publications] = await Promise.all([
    query(client, 'SELECT count(*)::text AS count FROM pg_prepared_xacts'),
    query(client, 'SELECT count(*)::text AS count, count(*) FILTER (WHERE slot_type = \'logical\')::text AS logical_count FROM pg_replication_slots'),
    query(client, 'SELECT count(*)::text AS count FROM pg_publication'),
  ]);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      transaction: 'SERIALIZABLE READ ONLY DEFERRABLE',
      noProductionArtifactsCreated: true,
      maxTables: MAX_TABLES,
      rawValuesIncluded: false,
    },
    capabilities: { settings, preparedTransactions: prepared[0], replicationSlots: slots[0], publications: publications[0] },
    tables,
    redactionProjectionInventory: columns.map((column) => ({ ...column, disposition: redactionDisposition(column.column) })),
  };
}

async function main() {
  const output = parseArguments(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (process.env.M1_INVENTORY_READ_ONLY_APPROVED !== 'yes') {
    throw new Error('M1_INVENTORY_READ_ONLY_APPROVED=yes is required');
  }
  const client = new Client({ connectionString: databaseUrl, application_name: 'meritocracy-m1-readonly-inventory' });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const readOnly = await query(client, "SELECT current_setting('transaction_read_only') AS value");
    if (readOnly[0]?.value !== 'on') throw new Error('read-only-transaction-not-enforced');
    const inventory = await buildInventory(client);
    await client.query('ROLLBACK');
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`Wrote redacted inventory: ${output}\n`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* no active transaction */ }
    throw new Error(safeError(error));
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { MAX_TABLES, parseArguments, redactionDisposition, safeError };
