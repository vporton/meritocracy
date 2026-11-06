#!/usr/bin/env node
'use strict';

// This command deliberately has no DDL, replication, or data-export path.  It
// writes only aggregate/catalog facts and a column-name based redaction plan.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MAX_TABLES = 256;
const MAX_ROWS_PER_AGGREGATE = 1_000_000_000;
const MAX_PROFILED_COLUMNS = 512;
const MAX_STATUS_BUCKETS = 64;
const MAX_CONSTRAINT_CHECKS = 512;
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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function exactTableCounts(client, tables) {
  const counts = [];
  for (const table of tables) {
    const qualified = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`;
    const rows = await query(client, `SELECT count(*)::text AS row_count FROM ${qualified}`);
    const count = rows[0]?.row_count;
    if (!/^(0|[1-9][0-9]*)$/.test(count || '') || BigInt(count) > BigInt(MAX_ROWS_PER_AGGREGATE)) {
      throw new Error('row-count-out-of-bounds');
    }
    counts.push({ schema: table.schema, table: table.table, rowCount: count });
  }
  return counts;
}

function isSensitiveColumn(column) {
  return SENSITIVE_COLUMN.test(column.column);
}

function isTextLike(column) {
  return ['text', 'character varying', 'character', 'json', 'jsonb'].includes(column.data_type);
}

function isDecimal(column) {
  return ['numeric', 'decimal', 'real', 'double precision'].includes(column.data_type);
}

async function profileColumns(client, columns) {
  const candidates = columns.filter((column) => !isSensitiveColumn(column) && (isTextLike(column) || isDecimal(column)));
  if (candidates.length > MAX_PROFILED_COLUMNS) throw new Error('profiled-column-cap-exceeded');
  const profiles = [];
  for (const column of candidates) {
    const qualified = `${quoteIdentifier(column.schema)}.${quoteIdentifier(column.table)}`;
    const field = quoteIdentifier(column.column);
    if (isTextLike(column)) {
      const rows = await query(client, `SELECT count(*) FILTER (WHERE ${field} IS NULL)::text AS null_count, COALESCE(max(octet_length(${field}::text)), 0)::text AS max_bytes FROM ${qualified}`);
      profiles.push({ schema: column.schema, table: column.table, column: column.column, kind: 'text_or_json', nullCount: rows[0].null_count, maxBytes: rows[0].max_bytes });
    } else {
      const rows = await query(client, `SELECT count(*) FILTER (WHERE ${field} IS NULL)::text AS null_count, min(${field})::text AS min, max(${field})::text AS max, COALESCE(sum(${field}), 0)::text AS sum FROM ${qualified}`);
      profiles.push({ schema: column.schema, table: column.table, column: column.column, kind: 'decimal', nullCount: rows[0].null_count, min: rows[0].min, max: rows[0].max, sum: rows[0].sum });
    }
  }
  return profiles;
}

async function buildStatusHistograms(client, columns) {
  const statusColumns = columns.filter((column) => column.column.toLowerCase() === 'status' && !isSensitiveColumn(column));
  const histograms = [];
  for (const column of statusColumns) {
    const qualified = `${quoteIdentifier(column.schema)}.${quoteIdentifier(column.table)}`;
    const field = quoteIdentifier(column.column);
    const rows = await query(client, `SELECT ${field}::text AS status, count(*)::text AS count FROM ${qualified} GROUP BY ${field} ORDER BY ${field} NULLS FIRST LIMIT ${MAX_STATUS_BUCKETS + 1}`);
    if (rows.length > MAX_STATUS_BUCKETS) throw new Error('status-bucket-cap-exceeded');
    histograms.push({ schema: column.schema, table: column.table, column: column.column, buckets: rows.map((row) => ({ status: row.status, count: row.count })) });
  }
  return histograms;
}

function qualifiedTable(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

async function buildUniqueCollisionChecks(client) {
  const indexes = await query(client, `
    SELECT ns.nspname AS schema, tbl.relname AS table, idx.relname AS index_name,
      json_agg(att.attname ORDER BY key.ordinality) AS columns
    FROM pg_index ind
    JOIN pg_class tbl ON tbl.oid = ind.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class idx ON idx.oid = ind.indexrelid
    JOIN unnest(ind.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
    JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum
    WHERE tbl.relkind IN ('r', 'p') AND ind.indisunique AND ind.indpred IS NULL
      AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    GROUP BY ns.nspname, tbl.relname, idx.relname
    ORDER BY ns.nspname, tbl.relname, idx.relname
    LIMIT $1`, [MAX_CONSTRAINT_CHECKS + 1]);
  if (indexes.length > MAX_CONSTRAINT_CHECKS) throw new Error('unique-index-cap-exceeded');
  const checks = [];
  for (const index of indexes) {
    const fields = index.columns.map(quoteIdentifier);
    const nonNull = fields.map((field) => `${field} IS NOT NULL`).join(' AND ');
    const rows = await query(client, `SELECT count(*)::text AS duplicate_groups FROM (SELECT 1 FROM ${qualifiedTable(index.schema, index.table)} WHERE ${nonNull} GROUP BY ${fields.join(', ')} HAVING count(*) > 1) duplicates`);
    checks.push({ schema: index.schema, table: index.table, index: index.index_name, columns: index.columns, duplicateGroups: rows[0].duplicate_groups });
  }
  return checks;
}

async function buildForeignKeyOrphanChecks(client) {
  const constraints = await query(client, `
    SELECT child_ns.nspname AS child_schema, child.relname AS child_table,
      con.conname AS constraint_name, parent_ns.nspname AS parent_schema,
      parent.relname AS parent_table,
      json_agg(child_att.attname ORDER BY child_key.ordinality) AS child_columns,
      json_agg(parent_att.attname ORDER BY child_key.ordinality) AS parent_columns
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS child_key(attnum, ordinality) ON true
    JOIN unnest(con.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality) ON parent_key.ordinality = child_key.ordinality
    JOIN pg_attribute child_att ON child_att.attrelid = child.oid AND child_att.attnum = child_key.attnum
    JOIN pg_attribute parent_att ON parent_att.attrelid = parent.oid AND parent_att.attnum = parent_key.attnum
    WHERE child.relkind IN ('r', 'p') AND con.contype = 'f' AND child_ns.nspname NOT IN ('pg_catalog', 'information_schema')
    GROUP BY child_ns.nspname, child.relname, con.conname, parent_ns.nspname, parent.relname
    ORDER BY child_ns.nspname, child.relname, con.conname
    LIMIT $1`, [MAX_CONSTRAINT_CHECKS + 1]);
  if (constraints.length > MAX_CONSTRAINT_CHECKS) throw new Error('foreign-key-cap-exceeded');
  const checks = [];
  for (const constraint of constraints) {
    const childColumns = constraint.child_columns.map(quoteIdentifier);
    const parentColumns = constraint.parent_columns.map(quoteIdentifier);
    const join = childColumns.map((column, i) => `c.${column} = p.${parentColumns[i]}`).join(' AND ');
    const nonNull = childColumns.map((column) => `c.${column} IS NOT NULL`).join(' AND ');
    const rows = await query(client, `SELECT count(*)::text AS orphan_count FROM ${qualifiedTable(constraint.child_schema, constraint.child_table)} c LEFT JOIN ${qualifiedTable(constraint.parent_schema, constraint.parent_table)} p ON ${join} WHERE ${nonNull} AND p.ctid IS NULL`);
    checks.push({ childSchema: constraint.child_schema, childTable: constraint.child_table, constraint: constraint.constraint_name, parentSchema: constraint.parent_schema, parentTable: constraint.parent_table, childColumns: constraint.child_columns, parentColumns: constraint.parent_columns, orphanCount: rows[0].orphan_count });
  }
  return checks;
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
  const tableCounts = await exactTableCounts(client, tables);
  const [columnProfiles, statusHistograms, uniqueCollisionChecks, foreignKeyOrphanChecks, sequences] = await Promise.all([
    profileColumns(client, columns),
    buildStatusHistograms(client, columns),
    buildUniqueCollisionChecks(client),
    buildForeignKeyOrphanChecks(client),
    query(client, `SELECT schemaname AS schema, sequencename AS sequence, last_value::text, increment_by::text, max_value::text FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, sequencename LIMIT $1`, [MAX_CONSTRAINT_CHECKS + 1]),
  ]);
  if (sequences.length > MAX_CONSTRAINT_CHECKS) throw new Error('sequence-cap-exceeded');
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
      maxRowsPerAggregate: MAX_ROWS_PER_AGGREGATE,
      maxProfiledColumns: MAX_PROFILED_COLUMNS,
      maxStatusBuckets: MAX_STATUS_BUCKETS,
      maxConstraintChecks: MAX_CONSTRAINT_CHECKS,
      rawValuesIncluded: false,
    },
    capabilities: { settings, preparedTransactions: prepared[0], replicationSlots: slots[0], publications: publications[0] },
    tables,
    tableCounts,
    columnProfiles,
    statusHistograms,
    uniqueCollisionChecks,
    foreignKeyOrphanChecks,
    sequences,
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

module.exports = { MAX_TABLES, MAX_ROWS_PER_AGGREGATE, MAX_PROFILED_COLUMNS, MAX_STATUS_BUCKETS, parseArguments, quoteIdentifier, redactionDisposition, safeError };
