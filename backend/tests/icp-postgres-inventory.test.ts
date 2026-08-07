import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EXPECTED_TABLES, buildTableStatisticsQuery, inventoryFailureCode, isRedactedColumn } from '../scripts/icp-postgres-inventory.js';

test('inventory covers all 22 known physical tables', () => {
  assert.equal(EXPECTED_TABLES.length, 22);
  assert.ok(EXPECTED_TABLES.includes('ai_result_migration_exceptions'));
  assert.ok(EXPECTED_TABLES.includes('system_secrets'));
});

test('raw secrets, bearer values, verification values, and payload credentials fail closed', () => {
  for (const [table, column] of [
    ['system_secrets', 'value'],
    ['sessions', 'token'],
    ['email_verification_tokens', 'token'],
    ['email_verification_tokens', 'email'],
    ['kyc_tokens', 'token'],
    ['users', 'kycData'],
    ['users', 'kycRejectionReason'],
    ['openai_logs', 'requestData'],
    ['pending_transactions', 'transactionData'],
    ['anything', 'newCredentialBlob'],
  ]) assert.equal(isRedactedColumn(table, column), true);
});

test('per-table aggregate query never references a redacted value column', () => {
  const sql = buildTableStatisticsQuery('public', 'system_secrets', [
    { table_name: 'system_secrets', column_name: 'id', data_type: 'integer', udt_name: 'int4' },
    { table_name: 'system_secrets', column_name: 'name', data_type: 'text', udt_name: 'text' },
    { table_name: 'system_secrets', column_name: 'value', data_type: 'text', udt_name: 'text' },
  ]);
  assert.match(sql, /max\(octet_length\("name"::text\)\)/);
  assert.doesNotMatch(sql, /"value"/);
  assert.doesNotMatch(sql, /SELECT \*/i);
});

test('database endpoint metadata is hashed rather than retained in the report capability object', async () => {
  const source = await readFile(new URL('../scripts/icp-postgres-inventory.ts', import.meta.url), 'utf8');
  assert.match(source, /databaseFingerprint: createHash\('sha256'\)/);
  assert.match(source, /database_name: databaseName/);
  assert.doesNotMatch(source, /capability: \{ \.\.\.capability, slotCapacity/);
});

test('identifier validation rejects SQL injection-shaped metadata', () => {
  assert.throws(() => buildTableStatisticsQuery('public', 'users; DROP TABLE users', []), /identifier/);
});

test('inventory connection failures retain only a safe operational category', () => {
  assert.equal(inventoryFailureCode(Object.assign(new Error('password authentication failed'), { code: '28P01' })), 'INVENTORY_DATABASE_AUTH_FAILED');
  assert.equal(inventoryFailureCode(Object.assign(new Error('permission denied'), { code: '42501' })), 'INVENTORY_DATABASE_PERMISSION_DENIED');
  assert.equal(inventoryFailureCode(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })), 'INVENTORY_DATABASE_UNREACHABLE');
  assert.equal(inventoryFailureCode(new Error('users table mismatch')), 'INVENTORY_VALIDATION_FAILED');
  assert.equal(inventoryFailureCode(new Error('unexpected')), 'INVENTORY_QUERY_FAILED');
});
