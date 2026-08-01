/**
 * Deterministic, data-only M1 canonical codec.
 *
 * This module deliberately has no PostgreSQL, replication, filesystem, network,
 * or target-canister capability.  M4 may reuse it only after the independently
 * implemented Motoko codec has passed the same golden vectors.
 */
import { createHash } from 'node:crypto';

export const CANONICAL_FORMAT = 'meritocracy-migration-canonical-v1';
export const LOGICAL_ID_FORMAT = 'meritocracy-legacy-logical-id-v1';
export const SHA256_PREFIX = 'sha256:';

export type CanonicalScalar = null | boolean | string;
export type CanonicalValue = CanonicalScalar | CanonicalValue[] | { readonly [key: string]: CanonicalValue };

export type SourceRecordInput = Readonly<{
  table: string;
  pk: CanonicalValue;
  row: CanonicalValue;
}>;

export type CanonicalSourceRecord = Readonly<{
  table: string;
  pk: CanonicalValue;
  row: CanonicalValue;
  sourceRowHash: string;
}>;

const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;
const BASE64URL = /^(?:[A-Za-z0-9_-]{2,}|[A-Za-z0-9_-])?$/;
const F64 = /^[0-9a-f]{16}$/;
const RFC3339_MILLIS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const limit = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < limit; index += 1) {
    const difference = leftPoints[index].codePointAt(0)! - rightPoints[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function fail(message: string): never {
  throw new TypeError(`Invalid ${CANONICAL_FORMAT} value: ${message}`);
}

function isRecord(value: CanonicalValue): value is { readonly [key: string]: CanonicalValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireOnlyKeys(value: { readonly [key: string]: CanonicalValue }, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail('tagged scalar has unexpected keys');
}

function assertTaggedScalar(value: { readonly [key: string]: CanonicalValue }): void {
  const keys = Object.keys(value);
  if (!keys.some((key) => key.startsWith('$'))) return;
  if (keys.length !== 1 && !(keys.length === 2 && '$decimal' in value) && !(keys.length === 3 && '$timestamp' in value)) {
    fail('tagged scalar is malformed');
  }
  if ('$int' in value) {
    requireOnlyKeys(value, ['$int']);
    if (typeof value.$int !== 'string' || !INTEGER.test(value.$int)) fail('$int must be a normalized decimal string');
    return;
  }
  if ('$f64' in value) {
    requireOnlyKeys(value, ['$f64']);
    if (typeof value.$f64 !== 'string' || !F64.test(value.$f64)) fail('$f64 must be lowercase 16-digit IEEE-754 hex');
    return;
  }
  if ('$bytes' in value) {
    requireOnlyKeys(value, ['$bytes']);
    if (typeof value.$bytes !== 'string' || !BASE64URL.test(value.$bytes)) fail('$bytes must be unpadded base64url');
    return;
  }
  if ('$decimal' in value) {
    requireOnlyKeys(value, ['$decimal']);
    if (!isRecord(value.$decimal) || typeof value.$decimal.coefficient !== 'string' || typeof value.$decimal.scale !== 'string') {
      fail('$decimal must contain coefficient and scale strings');
    }
    requireOnlyKeys(value.$decimal, ['coefficient', 'scale']);
    if (!INTEGER.test(value.$decimal.coefficient) || !/^(0|[1-9][0-9]*)$/.test(value.$decimal.scale)) {
      fail('$decimal fields must be normalized decimal strings');
    }
    return;
  }
  if ('$timestamp' in value) {
    requireOnlyKeys(value, ['$timestamp']);
    if (!isRecord(value.$timestamp)) fail('$timestamp must be an object');
    requireOnlyKeys(value.$timestamp, ['assumedZone', 'precision', 'value']);
    if (value.$timestamp.assumedZone !== 'UTC' || value.$timestamp.precision !== '3' || typeof value.$timestamp.value !== 'string' || !RFC3339_MILLIS_UTC.test(value.$timestamp.value)) {
      fail('$timestamp must be UTC at exactly millisecond precision');
    }
    return;
  }
  fail('unknown tagged scalar');
}

function assertCanonical(value: unknown): asserts value is CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'symbol' || typeof value === 'function') {
    fail('numbers and non-JSON values must use an explicit tagged scalar');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonical(item);
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('objects must be plain JSON records');
    for (const [key, child] of Object.entries(value)) {
      if (key.length === 0) fail('object keys cannot be empty');
      assertCanonical(child);
    }
    assertTaggedScalar(value as { readonly [key: string]: CanonicalValue });
    return;
  }
  fail('unsupported value');
}

/** Returns canonical JSON without a trailing newline. */
export function canonicalJson(value: CanonicalValue): string {
  assertCanonical(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort(codePointCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256(bytes: string): string {
  return `${SHA256_PREFIX}${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

export function canonicalHash(value: CanonicalValue): string {
  return sha256(canonicalJson(value));
}

export function applicationLogicalId(table: string, pk: CanonicalValue): string {
  if (!TABLE_NAME.test(table)) throw new TypeError('Invalid source table name');
  return `${LOGICAL_ID_FORMAT}:${table}:${canonicalHash({ format: LOGICAL_ID_FORMAT, pk, table })}`;
}

export function sourceRowHash(input: SourceRecordInput): string {
  if (!TABLE_NAME.test(input.table)) throw new TypeError('Invalid source table name');
  return canonicalHash({ pk: input.pk, row: input.row, table: input.table });
}

export function sourceRecord(input: SourceRecordInput): CanonicalSourceRecord {
  return Object.freeze({
    pk: input.pk,
    row: input.row,
    sourceRowHash: sourceRowHash(input),
    table: input.table,
  });
}

/** Guard for hashes received from a manifest, receipt, or redacted source evidence. */
export function isSha256(value: string): boolean {
  return value.startsWith(SHA256_PREFIX) && SHA256_HEX.test(value.slice(SHA256_PREFIX.length));
}
