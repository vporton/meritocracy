import type { Identity } from '@icp-sdk/core/agent'
import { Principal } from '@icp-sdk/core/principal'

import type { IcActors } from './client'

// This transport is compiled only by the explicit Vite development mode
// `icp-browser-test`. IcpApp additionally requires import.meta.env.DEV, so a
// production build cannot select it even if an environment variable is set.
export const createBrowserTestActors = async (identity: Identity): Promise<IcActors> => {
  const principal = identity.getPrincipal()
  const ledger = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai')
  const asset = { ledger, symbol: 'ICP', decimals: 8 }
  const session = {
    session_principal: principal,
    user_id: 7n,
    issuer: { internet_identity: null },
    issued_at: 1_700_000_000_000_000_000n,
    expires_at: 4_000_000_000_000_000_000n,
    revoked_at: [],
  }
  let signedIn = false
  let accounts: any[] = []
  let evaluations: any[] = []
  const round = {
    id: 11n, asset, source_fund: new Uint8Array(32), status: { complete: null },
    dispute_ends_at: [1_900_000_000_000_000_000n], required_atoms: 300_000_000n,
    reserved_atoms: 0n, vault_subaccount: new Uint8Array(32), allocation_version: [new Uint8Array(32)],
  }
  const allocation = {
    draft: { id: 101n, user_id: 7n, amount_atoms: 300_000_000n, evidence_hash: new Uint8Array(32) },
    recipient_hash: [new Uint8Array(32)], state: { paid: 987n },
  }
  const dispute = {
    id: 41n, round_id: 11n, allocation_id: 101n, evidence_hash: new Uint8Array(32),
    reason_code: 'recipient-challenged', state: { upheld: null }, created_at: 1_800_000_000_000_000_000n,
  }
  const ok = <T>(value: T) => ({ ok: value })
  const registry = {
    current_session: async () => signedIn ? ok(session) : ({ err: { unauthorized: null } }),
    complete_internet_identity_login: async () => { signedIn = true; return ok(session) },
    begin_oauth_login: async () => ok({ login_url: '/icp?oauth=mock', attempt_id: new Uint8Array(32), expires_at: session.expires_at }),
    revoke_session: async () => { signedIn = false; return { ok: null } },
    list_my_payout_accounts: async () => ok(accounts),
    get_carried_balances: async () => ok([{ atoms: 50_000_000n, reason: 'no route at finalization', source_round: 10n, asset }]),
    add_payout_account: async (input: any) => {
      const account = { id: 1n, user_id: 7n, route: input.route, address: input.address, normalized_address: input.address,
        verification: { pending: null }, active: true, default_for_route: false,
        created_at: session.issued_at, verified_at: [] }
      accounts = [account]; return ok(account)
    },
    complete_icrc_payout_proof: async () => { accounts[0] = { ...accounts[0], verification: { verified: null }, verified_at: [session.issued_at] }; return ok(accounts[0]) },
    set_payout_account_active: async (_id: bigint, active: boolean) => { accounts[0] = { ...accounts[0], active }; return ok(accounts[0]) },
    set_default_payout_account: async () => { accounts[0] = { ...accounts[0], default_for_route: true }; return ok(accounts[0]) },
    revoke_payout_account: async () => { accounts[0] = { ...accounts[0], verification: { revoked: null }, active: false }; return ok(accounts[0]) },
  }
  const assessment = {
    list_evaluations: async () => ok({ items: evaluations, next_cursor: [] }),
    submit_evaluation: async (input: any) => {
      const value = { id: 21n, idempotency_key: input.idempotency_key, request_fingerprint: new Uint8Array(32), subject_user_id: 7n,
        input_hash: new Uint8Array(32), source_refs: input.source_refs, prompt_version: input.prompt_version,
        model_version: input.model_version, result_hash: [new Uint8Array(32)],
        outcome: [{ accepted: { weight_numerator: 3n, weight_denominator: 2n } }], status: { complete: null },
        attempt: 1, attempt_token: new Uint8Array(32), created_at: session.issued_at, updated_at: session.issued_at }
      evaluations = [value]; return ok(value)
    },
    retry_evaluation: async () => ok(evaluations[0]),
    propose_allocation: async () => ok({ evaluation_id: 21n, user_id: 7n, weight_numerator: 3n, weight_denominator: 2n, evidence_hash: new Uint8Array(32) }),
  }
  const rounds = {
    list_rounds: async () => ok({ items: [round], next_cursor: [] }),
    list_allocations: async () => ok({ items: [allocation], next_cursor: [] }),
    list_disputes: async () => ok({ items: [dispute], next_cursor: [] }),
    file_dispute: async () => ok(dispute),
    reconcile: async () => ok({ round_id: 11n, ledger_atoms: 0n, reserved_atoms: 0n, reconciled: true, checked_at: session.issued_at }),
  }
  const vault = {
    get_transfer: async () => ok({ allocation_id: 101n, to: { owner: principal, subaccount: [] }, amount_atoms: 300_000_000n,
      fee_atoms: [10_000n], memo: new Uint8Array(32), created_at_time: 1_800_000_000_000_000_000n, state: { sent: 987n } }),
  }
  return { agent: {} as never, registry, assessment, rounds, vault, audit: {} } as unknown as IcActors
}
