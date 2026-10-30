'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalJson, canonicalRow } = require('./canonical-migration-vectors.cjs');

test('canonical JSON sorts keys and rejects precision-losing numbers', () => {
  assert.equal(canonicalJson({ z: 'last', a: 'first' }), '{"a":"first","z":"last"}');
  assert.throws(() => canonicalJson({ value: 1 }), /tagged representation/);
});

test('canonical rows have a stable logical ID and reject prohibited raw values', () => {
  const input = { table: 'users', pk: { id: { $int: '1' } }, row: { id: { $int: '1' }, name: 'A' } };
  assert.deepEqual(canonicalRow(input), canonicalRow(input));
  assert.throws(() => canonicalRow({ ...input, row: { sessionToken: 'do-not-export' } }), /prohibited raw field/);
});
