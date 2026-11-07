import { Actor, HttpAgent, type ActorSubclass, type Identity } from '@icp-sdk/core/agent'
import { Principal } from '@icp-sdk/core/principal'

import { idlFactory as assessmentIdl } from '../declarations/assessment/assessment.did.js'
import type { _SERVICE as AssessmentService } from '../declarations/assessment/assessment.did'
import { idlFactory as auditIdl } from '../declarations/audit/audit.did.js'
import type { _SERVICE as AuditService } from '../declarations/audit/audit.did'
import { idlFactory as registryIdl } from '../declarations/registry/registry.did.js'
import type { _SERVICE as RegistryService } from '../declarations/registry/registry.did'
import { idlFactory as roundsIdl } from '../declarations/rounds/rounds.did.js'
import type { _SERVICE as RoundsService } from '../declarations/rounds/rounds.did'
import { idlFactory as vaultIdl } from '../declarations/vault/vault.did.js'
import type { _SERVICE as VaultService } from '../declarations/vault/vault.did'

export type CanisterName = 'registry' | 'assessment' | 'rounds' | 'vault' | 'audit'

const ENV_KEYS: Record<CanisterName, keyof ImportMetaEnv> = {
  registry: 'VITE_CANISTER_ID_REGISTRY',
  assessment: 'VITE_CANISTER_ID_ASSESSMENT',
  rounds: 'VITE_CANISTER_ID_ROUNDS',
  vault: 'VITE_CANISTER_ID_VAULT',
  audit: 'VITE_CANISTER_ID_AUDIT',
}

export const requireCanisterId = (
  name: CanisterName,
  env: ImportMetaEnv = import.meta.env,
): string => {
  const key = ENV_KEYS[name]
  const value = env[key]
  if (!value) throw new Error(`Missing ${key}`)
  try {
    return Principal.fromText(value).toText()
  } catch {
    throw new Error(`Invalid ${key}`)
  }
}

export interface IcClientOptions {
  identity?: Identity
  host?: string
  fetchLocalRootKey?: boolean
  env?: ImportMetaEnv
}

export interface IcActors {
  agent: HttpAgent
  registry: ActorSubclass<RegistryService>
  assessment: ActorSubclass<AssessmentService>
  rounds: ActorSubclass<RoundsService>
  vault: ActorSubclass<VaultService>
  audit: ActorSubclass<AuditService>
}

export const createIcActors = async (options: IcClientOptions = {}): Promise<IcActors> => {
  const env = options.env ?? import.meta.env
  const host = options.host ?? env.VITE_IC_HOST
  const agent = await HttpAgent.create({ identity: options.identity, host })
  // A fetched local root key disables mainnet certificate trust. Never allow
  // production bundles to opt into it, even through a mistaken runtime flag.
  const fetchLocalRootKey = import.meta.env.DEV && (options.fetchLocalRootKey ?? true)
  if (fetchLocalRootKey) await agent.fetchRootKey()

  return {
    agent,
    registry: Actor.createActor<RegistryService>(registryIdl, { agent, canisterId: requireCanisterId('registry', env) }),
    assessment: Actor.createActor<AssessmentService>(assessmentIdl, { agent, canisterId: requireCanisterId('assessment', env) }),
    rounds: Actor.createActor<RoundsService>(roundsIdl, { agent, canisterId: requireCanisterId('rounds', env) }),
    vault: Actor.createActor<VaultService>(vaultIdl, { agent, canisterId: requireCanisterId('vault', env) }),
    audit: Actor.createActor<AuditService>(auditIdl, { agent, canisterId: requireCanisterId('audit', env) }),
  }
}
