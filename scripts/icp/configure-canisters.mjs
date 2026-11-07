#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Principal } from '@icp-sdk/core/principal'

const CANISTERS = ['registry', 'assessment', 'rounds', 'vault', 'audit']
const HASH = /^[0-9a-f]{64}$/

const fail = (message) => { throw new Error(message) }
const text = (value, label) => {
  if (typeof value !== 'string' || value === '' || value.includes('REPLACE_')) fail(`${label} is not configured`)
  return JSON.stringify(value)
}
const principal = (value, label) => {
  text(value, label)
  try { if (Principal.fromText(value).isAnonymous()) fail(`${label} cannot be anonymous`) } catch { fail(`${label} is not a valid principal`) }
  return `principal ${JSON.stringify(value)}`
}
const natural = (value, label, { positive = false } = {}) => {
  const string = String(value)
  if (!/^(0|[1-9][0-9]*)$/.test(string) || (positive && string === '0')) fail(`${label} must be ${positive ? 'a positive' : 'a non-negative'} integer`)
  return string
}
const boolean = (value, label) => {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`)
  return String(value)
}
const vector = (values, render, label) => {
  if (!Array.isArray(values)) fail(`${label} must be an array`)
  return `vec { ${values.map((value, index) => render(value, `${label}[${index}]`)).join('; ')} }`
}
const blob = (hex, label) => {
  if (!HASH.test(hex ?? '')) fail(`${label} must be 64 lowercase hex characters`)
  return `blob "${hex.match(/../g).map((byte) => `\\${byte}`).join('')}"`
}
const record = (fields) => `record { ${Object.entries(fields).map(([key, value]) => `${key} = ${value}`).join('; ')} }`

function command(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) fail(`${name} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function readCanisterIds(network) {
  return Object.fromEntries(CANISTERS.map((name) => [name, command('dfx', ['canister', 'id', '--network', network, name])]))
}

export function buildConfigurationCalls(config, ids) {
  if (config?.schema !== 'meritocracy-icp-config/v1') fail('Unsupported ICP configuration schema')
  for (const name of CANISTERS) principal(ids[name], `canisters.${name}`)
  const registry = config.registry ?? {}
  const assessment = config.assessment ?? {}
  const roles = config.roles ?? {}

  const providers = vector(registry.oauth_providers, (provider, label) => {
    if (!['orcid', 'github', 'bitbucket', 'gitlab'].includes(provider?.kind)) fail(`${label}.kind must be orcid, github, bitbucket, or gitlab`)
    return record({ kind: `variant { ${provider.kind} }`, client_id: text(provider.client_id, `${label}.client_id`) })
  }, 'registry.oauth_providers')
  const issuers = vector(registry.attestation_issuers, (issuer, label) => record({
    name: text(issuer?.name, `${label}.name`),
    caller: principal(issuer?.caller, `${label}.caller`),
    public_key: blob(issuer?.public_key_hex, `${label}.public_key_hex`)
  }), 'registry.attestation_issuers')
  const principals = (values, label) => vector(values, principal, label)
  const strings = (values, label) => vector(values, text, label)

  return [
    ['registry', 'configure_authorities', record({
      rounds_canister: `opt ${principal(ids.rounds, 'canisters.rounds')}`,
      session_consumers: principals([ids.assessment, ids.rounds], 'registry.session_consumers'),
      attestation_issuers: issuers,
      allowed_domains: strings(registry.allowed_domains, 'registry.allowed_domains'),
      allowed_actions: strings(registry.allowed_actions, 'registry.allowed_actions'),
      oauth_site_url: text(registry.oauth_site_url, 'registry.oauth_site_url'),
      oauth_providers: providers,
      oauth_redirect_uris: strings(registry.oauth_redirect_uris, 'registry.oauth_redirect_uris')
    })],
    ['assessment', 'configure', record({
      submitters: principals([ids.rounds], 'assessment.submitters'),
      audit_canister: `opt ${principal(ids.audit, 'canisters.audit')}`,
      allowed_models: strings(assessment.allowed_models, 'assessment.allowed_models'),
      allowed_prompt_versions: vector(assessment.allowed_prompt_versions_hex, blob, 'assessment.allowed_prompt_versions_hex'),
      allowed_source_hosts: strings(assessment.allowed_source_hosts, 'assessment.allowed_source_hosts'),
      max_input_bytes: natural(assessment.max_input_bytes, 'assessment.max_input_bytes', { positive: true }),
      max_sources: natural(assessment.max_sources, 'assessment.max_sources'),
      max_weight_numerator: natural(assessment.max_weight_numerator, 'assessment.max_weight_numerator', { positive: true }),
      rate_limit_count: natural(assessment.rate_limit_count, 'assessment.rate_limit_count', { positive: true }),
      rate_limit_window_ns: natural(assessment.rate_limit_window_ns, 'assessment.rate_limit_window_ns', { positive: true }),
      max_attempts: natural(assessment.max_attempts, 'assessment.max_attempts', { positive: true })
    })],
    ['assessment', 'configure_registry', principal(ids.registry, 'canisters.registry')],
    ['assessment', 'configure_budget', record({
      paused: boolean(assessment.budget?.paused, 'assessment.budget.paused'),
      global_limit: natural(assessment.budget?.global_limit, 'assessment.budget.global_limit'),
      per_caller_limit: natural(assessment.budget?.per_caller_limit, 'assessment.budget.per_caller_limit'),
      window_ns: natural(assessment.budget?.window_ns, 'assessment.budget.window_ns', { positive: true })
    })],
    ['rounds', 'configure_authorities', record({
      registry_canister: principal(ids.registry, 'canisters.registry'),
      vault_canister: principal(ids.vault, 'canisters.vault'),
      audit_canister: principal(ids.audit, 'canisters.audit'),
      managers: principals(roles.rounds_managers, 'roles.rounds_managers'),
      dispute_resolvers: principals(roles.dispute_resolvers, 'roles.dispute_resolvers')
    })],
    ['vault', 'configure_authorities', record({
      rounds_canister: principal(ids.rounds, 'canisters.rounds'),
      supported_ledgers: principals(config.supported_ledgers, 'supported_ledgers')
    })],
    ['audit', 'configure_authorities', record({
      appenders: principals([ids.registry, ids.assessment, ids.rounds, ids.vault], 'audit.appenders')
    })]
  ].map(([canister, method, argument]) => ({ canister, method, argument: `(${argument})` }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const configPath = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--network')
  const networkIndex = args.indexOf('--network')
  const network = networkIndex >= 0 ? args[networkIndex + 1] : 'local'
  const dryRun = args.includes('--dry-run')
  if (!configPath) fail('usage: configure-canisters.mjs CONFIG [--network NETWORK] [--dry-run]')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const calls = buildConfigurationCalls(config, readCanisterIds(network))
  for (const call of calls) {
    if (dryRun) console.log(`dfx canister call --network ${network} ${call.canister} ${call.method} ${JSON.stringify(call.argument)}`)
    else {
      const output = command('dfx', ['canister', 'call', '--network', network, call.canister, call.method, call.argument])
      if (!/variant\s*\{\s*ok/.test(output)) fail(`${call.canister}.${call.method} rejected configuration: ${output}`)
      console.log(`configured ${call.canister}.${call.method}`)
    }
  }
}
