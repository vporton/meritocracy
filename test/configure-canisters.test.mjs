import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildConfigurationCalls } from '../scripts/icp/configure-canisters.mjs'

const principal = 'ryjl3-tyaaa-aaaaa-aaaba-cai'
const ids = Object.fromEntries(['registry', 'assessment', 'rounds', 'vault', 'audit'].map((name) => [name, principal]))

function configuredExample() {
  const config = JSON.parse(readFileSync(new URL('../icp/config.example.json', import.meta.url)))
  for (const provider of config.registry.oauth_providers) provider.client_id = `${provider.kind}-client-id`
  config.assessment.allowed_prompt_versions_hex = ['00'.repeat(32)]
  config.roles.rounds_managers = [principal]
  config.roles.dispute_resolvers = [principal]
  return config
}

test('ICP config generates every governed configuration call', () => {
  const calls = buildConfigurationCalls(configuredExample(), ids)
  assert.deepEqual(calls.map(({ canister, method }) => `${canister}.${method}`), [
    'registry.configure_authorities',
    'assessment.configure',
    'assessment.configure_registry',
    'assessment.configure_budget',
    'rounds.configure_authorities',
    'vault.configure_authorities',
    'audit.configure_authorities'
  ])
  for (const provider of ['orcid', 'github', 'bitbucket', 'gitlab']) {
    assert.match(calls[0].argument, new RegExp(`${provider}-client-id`))
  }
})

test('ICP config rejects unconfigured OAuth client IDs', () => {
  const config = configuredExample()
  config.registry.oauth_providers[0].client_id = 'REPLACE_WITH_GITHUB_CLIENT_ID'
  assert.throws(() => buildConfigurationCalls(config, ids), /client_id is not configured/)
})
