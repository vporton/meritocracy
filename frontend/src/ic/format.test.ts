import assert from 'node:assert/strict'
import test from 'node:test'

import { IcCallError, normalizeAppError, optional, toOptional, unwrapResult, variantTag } from './candid.ts'
import { formatAtoms, nanosecondsToDate } from './format.ts'
import { parseHash32, shortHash } from './hash.ts'

test('formats arbitrary precision atoms without Number conversion', () => {
  assert.equal(formatAtoms(123456789012345678901n, 8), '1234567890123.45678901')
  assert.equal(formatAtoms(100000000n, 8), '1')
  assert.equal(formatAtoms(1n, 8), '0.00000001')
  assert.equal(formatAtoms(-1200n, 3), '-1.2')
})

test('converts nanoseconds only at the Date boundary', () => {
  assert.equal(nanosecondsToDate(1_700_000_000_123_456_789n).getTime(), 1_700_000_000_123)
})

test('decodes Candid optional, variant, result and errors', () => {
  assert.equal(optional<string>([]), undefined)
  assert.equal(optional(['value']), 'value')
  assert.deepEqual(toOptional(undefined), [])
  assert.deepEqual(toOptional('value'), ['value'])
  assert.equal(variantTag({ paid: 12n }), 'paid')
  assert.equal(unwrapResult({ ok: 9n }), 9n)
  assert.throws(() => unwrapResult({ err: { forbidden: null } }), IcCallError)
  assert.deepEqual(normalizeAppError({ rate_limited: { retry_after_ns: 25n } }), {
    tag: 'rate_limited',
    detail: { retry_after_ns: 25n },
    retryAfterNs: 25n,
    message: 'Too many requests. Please retry later.',
  })
})

test('parses only canonical 32-byte hexadecimal commitments', () => {
  const parsed = parseHash32('ab'.repeat(32))
  assert.equal(parsed.length, 32)
  assert.equal(shortHash(parsed), 'abababababab')
  assert.throws(() => parseHash32('ab'))
  assert.throws(() => parseHash32('zz'.repeat(32)))
})
