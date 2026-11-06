'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArguments, quoteIdentifier, redactionDisposition, safeError } = require('./inventory-postgres.cjs');

test('secret-like columns are excluded from raw projections', () => {
  for (const name of ['value', 'token', 'sessionToken', 'kycData', 'privateKey', 'emailVerificationToken']) {
    const result = redactionDisposition(name);
    if (name === 'value') assert.equal(result, 'REVIEW_FOR_EXPLICIT_PROJECTION');
    else assert.match(result, /^EXCLUDE_RAW_VALUE/);
  }
});

test('output is explicit and errors never include source details', () => {
  assert.throws(() => parseArguments([]), /Usage/);
  assert.equal(parseArguments(['--output', '/tmp/inventory.json']), '/tmp/inventory.json');
  assert.equal(safeError({ code: 'ECONNREFUSED', message: 'postgres://secret@host' }), 'inventory failed (ECONNREFUSED)');
});

test('dynamic aggregate identifiers are quoted, not interpolated as SQL', () => {
  assert.equal(quoteIdentifier('users'), '"users"');
  assert.equal(quoteIdentifier('odd"name'), '"odd""name"');
});
