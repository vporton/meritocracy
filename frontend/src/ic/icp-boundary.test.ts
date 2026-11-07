import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = ['IcpApp.tsx', 'client.ts', 'session.ts']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n')

test('ICP preview has no Express or Axios dependency', () => {
  assert.doesNotMatch(source, /['"`]\/api(?:\/|['"`])/)
  assert.doesNotMatch(source, /from ['"]axios['"]/)
  assert.doesNotMatch(source, /services\/api/)
})

test('session identity stays tab-scoped', () => {
  assert.match(source, /sessionStorage/)
  assert.doesNotMatch(source, /window\.localStorage/)
})
