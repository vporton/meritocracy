/**
 * M1 PostgreSQL inventory.
 *
 * This command intentionally has no export, replication, or DDL capability.  It
 * opens a SERIALIZABLE, READ ONLY, DEFERRABLE transaction and writes aggregate metadata
 * only.  In particular, it never selects a secret/token/credential value.
 */
import { createHash } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const EXPECTED_TABLES = [
  'users',
  'user_emails',
  'ban_votes',
  'sessions',
  'ethereum_auth_challenges',
  'batches',
  'batch_mappings',
  'non_batches',
  'non_batch_mappings',
  'tasks',
  'ai_results',
  'ai_result_sources',
  'task_dependencies',
  'openai_logs',
  'global',
  'gas_token_distributions',
  'gas_token_reserves',
  'email_verification_tokens',
  'kyc_tokens',
  'system_secrets',
  'pending_transactions',
  'ai_result_migration_exceptions',
] as const;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATUS_VALUES: Record<string, readonly string[]> = {
  'users.kycStatus': ['PENDING', 'VERIFIED', 'REJECTED'],
  'users.livelinessStatus': ['PENDING', 'VERIFIED', 'REJECTED'],
  'users.kycVotingStatus': ['PENDING', 'VERIFIED', 'REJECTED'],
  'tasks.status': ['NOT_STARTED', 'RUNNING', 'COMPLETED', 'FAILED'],
  'ai_results.status': ['PENDING', 'COMPLETED', 'FAILED'],
  'gas_token_distributions.status': ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  'pending_transactions.status': ['PENDING', 'EXECUTING', 'COMPLETED', 'FAILED'],
  'ban_votes.type': ['BAN', 'UNBAN'],
};

export type SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
};

export interface ReadonlySqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

type PgClient = ReadonlySqlClient & { connect(): Promise<void>; end(): Promise<void> };
const require = createRequire(import.meta.url);
// `pg` is a runtime dependency but this repository does not install @types/pg.
const { Client } = require('pg') as { Client: new (config: Record<string, string>) => PgClient };

type Column = { table_name: string; column_name: string; data_type: string; udt_name: string };
type ForeignKey = { constraint_name: string; table_name: string; columns: string[]; foreign_table: string; foreign_columns: string[] };
type UniqueIndex = { index_name: string; table_name: string; columns: string[]; is_primary: boolean };

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER.test(identifier)) throw new Error('Unexpected database identifier');
  return `"${identifier}"`;
}

function tableKey(table: string, column: string): string {
  return `${table}.${column}`;
}

/** Values are intentionally never selected for these fields, even to compute a length. */
export function isRedactedColumn(table: string, column: string): boolean {
  const key = tableKey(table, column);
  if (new Set([
    'system_secrets.value',
    'sessions.token',
    'email_verification_tokens.token',
    'email_verification_tokens.email',
    'kyc_tokens.token',
    'users.email',
    'users.kycData',
    'users.kycVotingData',
    'users.personalNumber',
    'user_emails.email',
    'openai_logs.requestData',
    'openai_logs.responseData',
    'pending_transactions.transactionData',
    'ai_result_migration_exceptions.responseData',
  ]).has(key)) return true;

  if (column.toLowerCase() === 'email') return true;
  if (/^kyc(?:Voting)?(?:Data|RejectionReason)$/i.test(column)) return true;

  // New credential columns must fail closed until their source projection is reviewed.
  return /secret|token|password|credential|private.?key|bearer/i.test(column);
}

function scalarExpressions(columns: Column[], aggregate: 'nulls' | 'maxBytes'): string[] {
  return columns
    .filter((column) => !isRedactedColumn(column.table_name, column.column_name))
    .map((column) => {
      const name = quoteIdentifier(column.column_name);
      const key = `'${column.column_name.replaceAll("'", "''")}'`;
      if (aggregate === 'nulls') return `${key}, count(*) FILTER (WHERE ${name} IS NULL)`;
      return `${key}, max(octet_length(${name}::text))`;
    });
}

export function buildTableStatisticsQuery(schema: string, table: string, columns: Column[]): string {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const nulls = scalarExpressions(columns, 'nulls');
  const maxBytes = scalarExpressions(columns, 'maxBytes');
  const numeric = columns
    .filter((column) => ['numeric', 'decimal'].includes(column.data_type))
    .map((column) => {
      const name = quoteIdentifier(column.column_name);
      const key = `'${column.column_name.replaceAll("'", "''")}'`;
      return `${key}, jsonb_build_object('min', min(${name})::text, 'max', max(${name})::text, 'sum', sum(${name})::text)`;
    });

  return `SELECT jsonb_build_object(
    'exactRowCount', count(*),
    'nullCounts', jsonb_build_object(${nulls.join(', ') || "'none', 0"}),
    'maxFieldBytes', jsonb_build_object(${maxBytes.join(', ') || "'none', 0"}),
    'decimalRanges', jsonb_build_object(${numeric.join(', ') || "'none', null"})
  ) AS statistics FROM ${qualified}`;
}

function safeStatusHistogramQuery(schema: string, table: string, column: string, allowed: readonly string[]): string {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const field = quoteIdentifier(column);
  // Unexpected application strings are deliberately coalesced rather than emitted.
  return `SELECT CASE WHEN ${field} IS NULL THEN '<null>' WHEN ${field} = ANY($1::text[]) THEN ${field} ELSE '<other>' END AS bucket, count(*)::text AS count FROM ${qualified} GROUP BY 1 ORDER BY 1`;
}

function assertExpectedTables(rows: Array<{ table_name: string }>): void {
  const actual = rows.map((row) => row.table_name).sort();
  const expected = [...EXPECTED_TABLES].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`Physical-table inventory mismatch: expected ${expected.length} application tables`);
  }
}

async function queryOne<Row extends Record<string, unknown>>(client: ReadonlySqlClient, text: string, values?: readonly unknown[]): Promise<Row> {
  const result = await client.query<Row>(text, values);
  if (result.rows.length !== 1) throw new Error('Inventory query did not return exactly one row');
  return result.rows[0];
}

async function foreignKeyOrphans(client: ReadonlySqlClient, schema: string, foreignKeys: ForeignKey[]): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};
  for (const key of foreignKeys) {
    if (key.columns.length !== key.foreign_columns.length || key.columns.length === 0) throw new Error('Invalid foreign-key metadata');
    const source = `${quoteIdentifier(schema)}.${quoteIdentifier(key.table_name)}`;
    const destination = `${quoteIdentifier(schema)}.${quoteIdentifier(key.foreign_table)}`;
    const joins = key.columns.map((column, index) => `s.${quoteIdentifier(column)} = d.${quoteIdentifier(key.foreign_columns[index])}`).join(' AND ');
    const present = key.columns.map((column) => `s.${quoteIdentifier(column)} IS NOT NULL`).join(' AND ');
    const row = await queryOne<{ count: string }>(client, `SELECT count(*)::text AS count FROM ${source} s LEFT JOIN ${destination} d ON ${joins} WHERE (${present}) AND d.${quoteIdentifier(key.foreign_columns[0])} IS NULL`);
    counts[key.constraint_name] = row.count;
  }
  return counts;
}

async function uniqueCollisions(client: ReadonlySqlClient, schema: string, indexes: UniqueIndex[]): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};
  for (const index of indexes) {
    if (index.columns.length === 0) throw new Error('Invalid unique-index metadata');
    const source = `${quoteIdentifier(schema)}.${quoteIdentifier(index.table_name)}`;
    const fields = index.columns.map(quoteIdentifier).join(', ');
    const allPresent = index.columns.map((column) => `${quoteIdentifier(column)} IS NOT NULL`).join(' AND ');
    const row = await queryOne<{ count: string }>(client, `SELECT count(*)::text AS count FROM (SELECT 1 FROM ${source} WHERE ${allPresent} GROUP BY ${fields} HAVING count(*) > 1) collisions`);
    counts[index.index_name] = row.count;
  }
  return counts;
}

export async function collectInventory(client: ReadonlySqlClient, schema = 'public'): Promise<Record<string, unknown>> {
  if (!IDENTIFIER.test(schema)) throw new Error('Schema must be a simple PostgreSQL identifier');

  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE');
  try {
    const capability = await queryOne(client, `SELECT
      current_setting('server_version_num') AS server_version_num,
      current_setting('wal_level', true) AS wal_level,
      current_setting('max_replication_slots', true) AS max_replication_slots,
      current_setting('max_wal_senders', true) AS max_wal_senders,
      current_setting('max_slot_wal_keep_size', true) AS max_slot_wal_keep_size,
      current_setting('idle_replication_slot_timeout', true) AS idle_replication_slot_timeout,
      current_setting('max_prepared_transactions', true) AS max_prepared_transactions,
      current_setting('wal_keep_size', true) AS wal_keep_size,
      current_setting('default_transaction_read_only', true) AS default_transaction_read_only,
      current_setting('TimeZone', true) AS timezone,
      current_setting('server_encoding', true) AS server_encoding,
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'local') AS server_address,
      inet_server_port()::text AS server_port,
      EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pg_create_logical_replication_slot') AS logical_slot_api_available,
      EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pg_logical_slot_get_changes') AS logical_decode_api_available`);

    const slotCapacity = await queryOne(client, `SELECT count(*)::text AS total_slots,
      count(*) FILTER (WHERE slot_type = 'logical')::text AS logical_slots,
      count(*) FILTER (WHERE active)::text AS active_slots,
      count(*) FILTER (WHERE NOT active)::text AS inactive_slots
      FROM pg_replication_slots`);
    const prepared = await queryOne(client, 'SELECT count(*)::text AS active_prepared_transactions FROM pg_prepared_xacts');

    const tableRows = await client.query<{ table_name: string }>(`SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND c.relname = ANY($2::text[])
      ORDER BY c.relname`, [schema, EXPECTED_TABLES]);
    assertExpectedTables(tableRows.rows);

    const columnsResult = await client.query<Column>(`SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[])
      ORDER BY table_name, ordinal_position`, [schema, EXPECTED_TABLES]);
    const columnsByTable = new Map<string, Column[]>();
    for (const column of columnsResult.rows) columnsByTable.set(column.table_name, [...(columnsByTable.get(column.table_name) ?? []), column]);

    const relations = await client.query(`SELECT c.relname AS table_name, c.relreplident AS replica_identity,
      COALESCE(pk.columns, ARRAY[]::text[]) AS primary_key, COALESCE(ri.columns, ARRAY[]::text[]) AS replica_identity_key,
      pg_total_relation_size(c.oid)::text AS total_bytes, pg_relation_size(c.oid)::text AS table_bytes,
      pg_indexes_size(c.oid)::text AS index_bytes, COALESCE(pg_total_relation_size(c.reltoastrelid), 0)::text AS toast_bytes,
      EXISTS (SELECT 1 FROM pg_publication_tables p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS in_publication
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN LATERAL (SELECT array_agg(a.attname ORDER BY x.ordinality) AS columns FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY x(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.attnum WHERE i.indisprimary) pk ON true
      LEFT JOIN LATERAL (SELECT array_agg(a.attname ORDER BY x.ordinality) AS columns FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY x(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.attnum WHERE i.indisreplident) ri ON true
      WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname`, [schema, EXPECTED_TABLES]);

    const foreignKeys = await client.query<ForeignKey>(`SELECT con.conname AS constraint_name, src.relname AS table_name,
      array_agg(src_attr.attname ORDER BY source_key.ordinality) AS columns, dst.relname AS foreign_table,
      array_agg(dst_attr.attname ORDER BY source_key.ordinality) AS foreign_columns
      FROM pg_constraint con JOIN pg_class src ON src.oid = con.conrelid JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY source_key(attnum, ordinality)
      JOIN pg_attribute src_attr ON src_attr.attrelid = src.oid AND src_attr.attnum = source_key.attnum
      JOIN pg_attribute dst_attr ON dst_attr.attrelid = dst.oid AND dst_attr.attnum = con.confkey[source_key.ordinality]
      WHERE con.contype = 'f' AND n.nspname = $1 AND src.relname = ANY($2::text[])
      GROUP BY con.conname, src.relname, dst.relname ORDER BY con.conname`, [schema, EXPECTED_TABLES]);
    const uniqueIndexes = await client.query<UniqueIndex>(`SELECT i.relname AS index_name, c.relname AS table_name,
      array_agg(a.attname ORDER BY keys.ordinality) AS columns, x.indisprimary AS is_primary
      FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY keys(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = keys.attnum
      WHERE x.indisunique AND n.nspname = $1 AND c.relname = ANY($2::text[])
      GROUP BY i.relname, c.relname, x.indisprimary ORDER BY i.relname`, [schema, EXPECTED_TABLES]);

    const tables: Record<string, unknown> = {};
    const redactionProjection: Record<string, unknown> = {};
    const statusHistograms: Record<string, unknown> = {};
    for (const table of EXPECTED_TABLES) {
      const columns = columnsByTable.get(table) ?? [];
      if (!columns.length) throw new Error(`No columns returned for ${table}`);
      const statistic = await queryOne<{ statistics: unknown }>(client, buildTableStatisticsQuery(schema, table, columns));
      tables[table] = statistic.statistics;
      redactionProjection[table] = columns.map((column) => ({
        column: column.column_name,
        dataType: column.data_type,
        export: isRedactedColumn(table, column.column_name) ? 'REDACTED_METADATA_OR_DIGEST_ONLY' : 'REVIEW_REQUIRED_EXPLICIT_PROJECTION',
      }));
      for (const [key, allowed] of Object.entries(STATUS_VALUES)) {
        const [statusTable, statusColumn] = key.split('.');
        if (statusTable === table && columns.some((column) => column.column_name === statusColumn)) {
          const result = await client.query<{ bucket: string; count: string }>(safeStatusHistogramQuery(schema, table, statusColumn, allowed), [allowed]);
          statusHistograms[key] = Object.fromEntries(result.rows.map((row) => [row.bucket, row.count]));
        }
      }
    }

    const sequences = await client.query(`SELECT sequence_name, last_value::text, start_value::text, increment_by::text
      FROM pg_sequences WHERE schemaname = $1 ORDER BY sequence_name`, [schema]);
    const { database_name: databaseName, server_address: serverAddress, server_port: serverPort, ...safeCapability } = capability as Record<string, unknown>;
    const report = {
      format: 'meritocracy-postgres-inventory-v1',
      collectedAt: new Date().toISOString(),
      schema,
      databaseFingerprint: createHash('sha256').update(`${databaseName}:${serverAddress}:${serverPort}`).digest('hex'),
      safety: {
        transaction: 'SERIALIZABLE READ ONLY DEFERRABLE',
        databaseWrites: false,
        replicationArtifactsCreated: false,
        rawValuesSelected: false,
        prohibitedValueClasses: ['SystemSecret.value', 'session bearer values', 'raw email/KYC verification values', 'private keys', 'credentials'],
      },
      capability: { ...safeCapability, slotCapacity, prepared },
      relations: relations.rows,
      tables,
      statusHistograms,
      foreignKeyOrphans: await foreignKeyOrphans(client, schema, foreignKeys.rows),
      uniqueCollisionCounts: await uniqueCollisions(client, schema, uniqueIndexes.rows),
      sequences: sequences.rows,
      redactionProjection,
      nextAction: 'Review this aggregate evidence. Do not create a publication, logical slot, trigger, or outbox until the G4-approved runbook.',
    };
    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function writeNewPrivateJson(outputPath: string, value: unknown): Promise<void> {
  const resolved = path.resolve(outputPath);
  const temporary = `${resolved}.tmp-${process.pid}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    // link(2) is atomic and refuses to replace an existing evidence file.
    await link(temporary, resolved);
    await unlink(temporary);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function usage(): string {
  return 'Usage: npm run inventory:postgres --workspace backend -- --output /secure/path/inventory.json [--schema public]';
}

export function inventoryFailureCode(error: unknown): string {
  if (error instanceof Error && /mismatch|No columns|identifier|Invalid/.test(error.message)) {
    return 'INVENTORY_VALIDATION_FAILED';
  }

  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  if (code === '28P01' || code === '28000') return 'INVENTORY_DATABASE_AUTH_FAILED';
  if (code === '42501') return 'INVENTORY_DATABASE_PERMISSION_DENIED';
  if (code?.startsWith('08') || ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'INVENTORY_DATABASE_UNREACHABLE';
  }
  return 'INVENTORY_QUERY_FAILED';
}

function parseArguments(args: string[]): { output: string; schema: string } {
  let output: string | undefined;
  let schema = 'public';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output') output = args[++index];
    else if (args[index] === '--schema') schema = args[++index];
    else if (args[index] === '--help') throw new Error('HELP');
    else throw new Error('Invalid arguments');
  }
  if (!output || !schema || !IDENTIFIER.test(schema)) throw new Error('Invalid arguments');
  return { output, schema };
}

async function main(): Promise<void> {
  let options: { output: string; schema: string };
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = error instanceof Error && error.message === 'HELP' ? 0 : 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is required; no connection was attempted.\n');
    process.exitCode = 2;
    return;
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'meritocracy-m1-readonly-inventory',
    options: '-c default_transaction_read_only=on',
  });
  try {
    await client.connect();
    const report = await collectInventory(client, options.schema);
    await writeNewPrivateJson(options.output, report);
    process.stdout.write(`Wrote aggregate-only inventory evidence to ${path.resolve(options.output)}\n`);
  } catch (error) {
    process.stderr.write(`${inventoryFailureCode(error)}: no database URL, credentials, endpoint, or row values were emitted.\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
