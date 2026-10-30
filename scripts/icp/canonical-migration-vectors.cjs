#!/usr/bin/env node
'use strict';

// Local M1 conformance vectors for the canonical migration representation.
// This is deliberately an offline codec: it has no database, network, or
// import-canister access and it refuses JavaScript numbers so precision cannot
// be lost before a typed PostgreSQL value is encoded.
const crypto = require('node:crypto');
const fs = require('node:fs');

const FORMAT = 'meritocracy-migration-canonical-v1';
const FORBIDDEN_KEY = /(password|secret|token|bearer|credential|private.?key|mnemonic|seed|verification|kyc.*data|liveliness.*data|session)/i;

function compareCodePoints(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'bigint') throw new TypeError('numeric scalars must use a tagged representation');
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('unsupported canonical value');
  return `{${Object.keys(value).sort(compareCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertRedacted(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertRedacted(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`prohibited raw field at ${path}.${key}`);
      assertRedacted(item, `${path}.${key}`);
    }
  }
}

function logicalId(table, pk) {
  if (typeof table !== 'string' || table.length === 0) throw new TypeError('table is required');
  return `legacy/${table}/${sha256(canonicalJson(pk))}`;
}

function canonicalRow({ table, pk, row }) {
  assertRedacted(row);
  const logical = logicalId(table, pk);
  const source = { format: FORMAT, logicalId: logical, pk, row, table };
  const sourceRowHash = sha256(canonicalJson(source));
  return { ...source, sourceRowHash };
}

function canonicalReceipt({ migrationId, table, ordinal, chunkHash }) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new TypeError('ordinal must be a non-negative safe integer');
  const logicalId = `receipt/${migrationId}/${table}/${ordinal}`;
  const receipt = { chunkHash, format: FORMAT, logicalId, migrationId, ordinal: { $int: String(ordinal) }, table };
  return { ...receipt, receiptHash: sha256(canonicalJson(receipt)) };
}

function runVectors(file) {
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fixture.format !== FORMAT) throw new Error('fixture format mismatch');
  const row = canonicalRow(fixture.row);
  const repeat = canonicalRow(fixture.row);
  const receipt = canonicalReceipt(fixture.receipt);
  const result = {
    rowBytes: canonicalJson(row), rowHash: row.sourceRowHash,
    repeatBytes: canonicalJson(repeat), receiptBytes: canonicalJson(receipt), receiptHash: receipt.receiptHash,
  };
  if (result.rowBytes !== result.repeatBytes || result.rowHash !== repeat.sourceRowHash) throw new Error('non-deterministic canonical row');
  for (const [key, expected] of Object.entries(fixture.expected || {})) {
    if (result[key] !== expected) throw new Error(`golden mismatch: ${key}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) runVectors(process.argv[2] || 'fixtures/migration_canonical_v1.json');

module.exports = { FORMAT, canonicalJson, canonicalReceipt, canonicalRow, logicalId, sha256 };
