// Stage 1 compile-time proof that the React application can consume every
// generated Candid interface. Actor construction and session identities are
// introduced in Stage 6; canister IDs always come from deployment environment.
export { idlFactory as registryIdl } from '../declarations/registry/registry.did.js'
export { idlFactory as assessmentIdl } from '../declarations/assessment/assessment.did.js'
export { idlFactory as roundsIdl } from '../declarations/rounds/rounds.did.js'
export { idlFactory as vaultIdl } from '../declarations/vault/vault.did.js'
export { idlFactory as auditIdl } from '../declarations/audit/audit.did.js'

export type { _SERVICE as RegistryService } from '../declarations/registry/registry.did'
export type { _SERVICE as AssessmentService } from '../declarations/assessment/assessment.did'
export type { _SERVICE as RoundsService } from '../declarations/rounds/rounds.did'
export type { _SERVICE as VaultService } from '../declarations/vault/vault.did'
export type { _SERVICE as AuditService } from '../declarations/audit/audit.did'
