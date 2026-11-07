import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Principal } from '@icp-sdk/core/principal'
import type { Evaluation } from '../declarations/assessment/assessment.did'
import type { PayoutAccount, Session } from '../declarations/registry/registry.did'
import type { Allocation, Dispute, Round } from '../declarations/rounds/rounds.did'
import type { Transfer } from '../declarations/vault/vault.did'
import { unwrapResult } from './candid'
import { createIcActors, type IcActors } from './client'
import { createBrowserTestActors } from './browserTestActors'
import { formatAtoms, formatNanosecondTimestamp } from './format'
import { parseHash32, randomHash32, sha256Text, shortHash } from './hash'
import { clearSessionIdentity, loadOrCreateSessionIdentity } from './session'
import './icp.css'

const page = { cursor: [] as [], limit: 100 }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
const tag = (value: object): string => Object.keys(value)[0] ?? 'unknown'

export default function IcpApp() {
  const identity = useMemo(loadOrCreateSessionIdentity, [])
  const [actors, setActors] = useState<IcActors>()
  const [session, setSession] = useState<Session>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accounts, setAccounts] = useState<PayoutAccount[]>([])
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [selectedRound, setSelectedRound] = useState<Round>()
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({})
  const [carried, setCarried] = useState<Array<{ atoms: bigint; reason: string; source_round: bigint; asset: Round['asset'] }>>([])
  const [payoutAddress, setPayoutAddress] = useState(identity.getPrincipal().toText())
  const [ledger, setLedger] = useState('ryjl3-tyaaa-aaaaa-aaaba-cai')
  const [symbol, setSymbol] = useState('ICP')
  const [decimals, setDecimals] = useState('8')
  const [provider, setProvider] = useState('github')
  const [evaluationText, setEvaluationText] = useState('')
  const [sourceUri, setSourceUri] = useState('')
  const [modelVersion, setModelVersion] = useState('gpt-4.1-mini')
  const [promptHash, setPromptHash] = useState('')

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('')
    try { await action() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }, [])

  const refreshSession = useCallback(async (client: IcActors) => {
    try {
      const current = unwrapResult(await client.registry.current_session())
      setSession(current)
      return current
    } catch {
      setSession(undefined)
      return undefined
    }
  }, [])

  useEffect(() => {
    const actorsPromise = import.meta.env.DEV && import.meta.env.MODE === 'icp-browser-test'
      ? createBrowserTestActors(identity)
      : createIcActors({ identity })
    void actorsPromise.then(async (client) => {
      setActors(client)
      await refreshSession(client)
      const listed = unwrapResult(await client.rounds.list_rounds({ status: [], page }))
      setRounds(listed.items)
    }).catch((caught) => setError(errorMessage(caught)))
  }, [identity, refreshSession])

  const refreshUserData = useCallback(async () => {
    if (!actors || !session) return
    const [payouts, balances, evaluationPage] = await Promise.all([
      actors.registry.list_my_payout_accounts(),
      actors.registry.get_carried_balances(session.user_id),
      actors.assessment.list_evaluations({ subject: [session.user_id], page }),
    ])
    setAccounts(unwrapResult(payouts))
    setCarried(unwrapResult(balances))
    setEvaluations(unwrapResult(evaluationPage).items)
  }, [actors, session])

  useEffect(() => { void refreshUserData().catch((caught) => setError(errorMessage(caught))) }, [refreshUserData])

  const createPrincipalSession = () => run('Creating session…', async () => {
    if (!actors) return
    const created = unwrapResult(await actors.registry.complete_internet_identity_login({
      session_principal: identity.getPrincipal(), requested_action: 'login',
    }))
    setSession(created); setNotice('Session created for this tab.')
  })

  const beginOAuth = (event: FormEvent) => {
    event.preventDefault()
    void run('Opening OAuth…', async () => {
      if (!actors) return
      const redirectUri = `${window.location.origin}/icp`
      const started = unwrapResult(await actors.registry.begin_oauth_login({
        provider, redirect_uri: redirectUri, session_principal: identity.getPrincipal(),
      }))
      window.location.assign(started.login_url)
    })
  }

  const logout = () => run('Revoking session…', async () => {
    if (actors) unwrapResult(await actors.registry.revoke_session(identity.getPrincipal()))
    clearSessionIdentity(); setSession(undefined); window.location.reload()
  })

  const addIcrcAccount = (event: FormEvent) => {
    event.preventDefault()
    void run('Adding payout account…', async () => {
      if (!actors) return
      const account = unwrapResult(await actors.registry.add_payout_account({
        address: payoutAddress,
        route: { network: { icp: null }, asset: [{ ledger: Principal.fromText(ledger), symbol, decimals: Number(decimals) }] },
      }))
      setAccounts((current) => [...current.filter(({ id }) => id !== account.id), account])
    })
  }

  const accountAction = (label: string, action: () => Promise<{ ok: PayoutAccount } | { err: unknown }>) => run(label, async () => {
    const updated = unwrapResult(await action())
    setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
  })

  const submitEvaluation = (event: FormEvent) => {
    event.preventDefault()
    void run('Submitting evaluation…', async () => {
      if (!actors || !session) return
      const sources = sourceUri.trim() ? [{ ordinal: 0, uri_hash: await sha256Text(sourceUri.trim()), allowed_uri: [sourceUri.trim()] as [string] }] : []
      const evaluation = unwrapResult(await actors.assessment.submit_evaluation({
        idempotency_key: randomHash32(), subject_user_id: session.user_id, input_text: evaluationText,
        source_refs: sources, prompt_version: parseHash32(promptHash), model_version: modelVersion,
      }))
      setEvaluations((current) => [evaluation, ...current.filter(({ id }) => id !== evaluation.id)])
    })
  }

  const retryEvaluation = (evaluation: Evaluation) => run('Retrying evaluation…', async () => {
    if (!actors) return
    const updated = unwrapResult(await actors.assessment.retry_evaluation({ evaluation_id: evaluation.id, input_text: evaluationText }))
    setEvaluations((current) => current.map((item) => item.id === updated.id ? updated : item))
  })

  const showProposal = (id: bigint) => run('Loading proposal…', async () => {
    if (!actors) return
    const proposal = unwrapResult(await actors.assessment.propose_allocation(id))
    setNotice(`Proposal ${proposal.evaluation_id}: ${proposal.weight_numerator}/${proposal.weight_denominator}; evidence ${shortHash(proposal.evidence_hash)}`)
  })

  const openRound = (round: Round) => run('Loading round…', async () => {
    if (!actors) return
    const allocationPage = unwrapResult(await actors.rounds.list_allocations(round.id, page))
    setSelectedRound(round); setAllocations(allocationPage.items)
    try { setDisputes(unwrapResult(await actors.rounds.list_disputes({ round_id: [round.id], state: [], page })).items) } catch { setDisputes([]) }
    const transferPairs = await Promise.all(allocationPage.items.map(async (allocation) => {
      try { return [allocation.draft.id.toString(), unwrapResult(await actors.vault.get_transfer(allocation.draft.id))] as const } catch { return undefined }
    }))
    setTransfers(Object.fromEntries(transferPairs.filter((pair): pair is readonly [string, Transfer] => pair !== undefined)))
  })

  const fileDispute = (allocation: Allocation) => run('Filing dispute…', async () => {
    if (!actors || !selectedRound) return
    const reason = window.prompt('Public dispute reason code')?.trim()
    if (!reason) return
    const dispute = unwrapResult(await actors.rounds.file_dispute({
      round_id: selectedRound.id, allocation_id: allocation.draft.id, reason_code: reason,
      evidence_hash: await sha256Text(reason),
    }))
    setDisputes((current) => [dispute, ...current])
    await openRound(selectedRound)
  })

  const reconcile = () => run('Reconciling round…', async () => {
    if (!actors || !selectedRound) return
    const result = unwrapResult(await actors.rounds.reconcile(selectedRound.id))
    setNotice(`Reconciliation: ${result.reconciled ? 'matched' : 'mismatch'}; ledger ${formatAtoms(result.ledger_atoms, selectedRound.asset.decimals)}, reserved ${formatAtoms(result.reserved_atoms, selectedRound.asset.decimals)}`)
  })

  return <div className="icp-app">
    <header className="icp-hero"><div><p className="eyebrow">ICP preview</p><h1>Meritocracy on-chain workspace</h1><p>This additive preview talks directly to canisters and never uses Express.</p></div><a href="/">Return to legacy app</a></header>
    {busy && <p role="status" className="icp-status">{busy}</p>}
    {error && <p role="alert" className="icp-error">{error}</p>}
    {notice && <p role="status" className="icp-notice">{notice}</p>}

    <section className="icp-card"><h2>Session</h2><p className="mono">Tab principal: {identity.getPrincipal().toText()}</p>
      {session ? <><p>Signed in as user {session.user_id.toString()} until {formatNanosecondTimestamp(session.expires_at)}.</p><button onClick={logout}>Revoke this session</button></> : <div className="icp-actions"><button onClick={createPrincipalSession} disabled={!actors}>Create principal session</button><form onSubmit={beginOAuth}><select value={provider} onChange={(e) => setProvider(e.target.value)}><option>orcid</option><option>github</option><option>bitbucket</option><option>gitlab</option></select><button disabled={!actors}>Continue with OAuth</button></form></div>}
      <p className="icp-help">The private session key is stored only in this tab’s sessionStorage so an OAuth redirect can return to it. Closing the tab clears it.</p>
    </section>

    {session && <>
      <section className="icp-card"><h2>ICRC payout accounts</h2><form className="icp-grid" onSubmit={addIcrcAccount}><label>Account owner / owner:subaccount<input value={payoutAddress} onChange={(e) => setPayoutAddress(e.target.value)} /></label><label>Ledger principal<input value={ledger} onChange={(e) => setLedger(e.target.value)} /></label><label>Symbol<input value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label><label>Decimals<input inputMode="numeric" value={decimals} onChange={(e) => setDecimals(e.target.value)} /></label><button>Add ICRC route</button></form>
        <p className="icp-help">Only ICRC routes are payable in this stage. Other networks remain visible in Registry but are not enabled for payment.</p>
        <ul className="icp-list">{accounts.map((account) => <li key={account.id.toString()}><div><strong>{tag(account.route.network)}</strong> · {tag(account.verification)} {account.default_for_route && '· default'}<br/><span className="mono">{account.normalized_address}</span></div><div className="icp-actions">{'pending' in account.verification && 'icp' in account.route.network && <button onClick={() => accountAction('Proving ownership…', () => actors!.registry.complete_icrc_payout_proof(account.id))}>Prove ICRC ownership</button>}<button onClick={() => accountAction('Updating account…', () => actors!.registry.set_payout_account_active(account.id, !account.active))}>{account.active ? 'Deactivate' : 'Activate'}</button><button onClick={() => accountAction('Setting default…', () => actors!.registry.set_default_payout_account(account.id))}>Set default</button><button onClick={() => accountAction('Revoking account…', () => actors!.registry.revoke_payout_account(account.id))}>Revoke</button></div></li>)}</ul>
      </section>

      <section className="icp-card"><h2>Evaluation</h2><form className="icp-grid" onSubmit={submitEvaluation}><label className="wide">Untrusted evidence text<textarea value={evaluationText} onChange={(e) => setEvaluationText(e.target.value)} required /></label><label>Allowed HTTPS source<input value={sourceUri} onChange={(e) => setSourceUri(e.target.value)} placeholder="https://…" /></label><label>Model version<input value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} required /></label><label className="wide">Prompt version (64 hex)<input value={promptHash} onChange={(e) => setPromptHash(e.target.value)} required /></label><button>Submit synchronously</button></form>
        <ul className="icp-list">{evaluations.map((evaluation) => <li key={evaluation.id.toString()}><div><strong>#{evaluation.id.toString()}</strong> · {tag(evaluation.status)} · attempt {evaluation.attempt}<br/><span className="mono">input {shortHash(evaluation.input_hash)}</span></div><div className="icp-actions">{'failed' in evaluation.status && <button onClick={() => retryEvaluation(evaluation)}>Retry with current text</button>}{'complete' in evaluation.status && <button onClick={() => showProposal(evaluation.id)}>View proposal</button>}</div></li>)}</ul>
      </section>

      <section className="icp-card"><h2>Carried balances</h2><ul className="icp-list">{carried.map((balance, index) => <li key={`${balance.source_round}-${index}`}><span>{formatAtoms(balance.atoms, balance.asset.decimals)} {balance.asset.symbol}</span><span>round {balance.source_round.toString()} · {balance.reason}</span></li>)}</ul></section>
    </>}

    <section className="icp-card"><h2>Rounds and payments</h2><ul className="icp-list">{rounds.map((round) => <li key={round.id.toString()}><div><strong>Round {round.id.toString()}</strong> · {tag(round.status)}<br/>{formatAtoms(round.required_atoms, round.asset.decimals)} {round.asset.symbol} · ledger <span className="mono">{round.asset.ledger.toText()}</span>{round.dispute_ends_at[0] !== undefined && <> · disputes end {formatNanosecondTimestamp(round.dispute_ends_at[0])}</>}</div><button onClick={() => openRound(round)}>Open</button></li>)}</ul>
      {selectedRound && <div className="icp-detail"><h3>Round {selectedRound.id.toString()}</h3><button onClick={reconcile}>Reconcile</button><ul className="icp-list">{allocations.map((allocation) => { const transfer = transfers[allocation.draft.id.toString()]; return <li key={allocation.draft.id.toString()}><div><strong>Allocation {allocation.draft.id.toString()}</strong> · {tag(allocation.state)}<br/>{formatAtoms(allocation.draft.amount_atoms, selectedRound.asset.decimals)} {selectedRound.asset.symbol}{transfer && <> · transfer {tag(transfer.state)}{'sent' in transfer.state && ` at block ${transfer.state.sent.toString()}`}</>}</div>{session && 'pending' in allocation.state && <button onClick={() => fileDispute(allocation)}>Dispute</button>}</li> })}</ul><h4>Disputes</h4><ul className="icp-list">{disputes.map((dispute) => <li key={dispute.id.toString()}><span>Allocation {dispute.allocation_id.toString()} · {tag(dispute.state)}</span><span>{dispute.reason_code}</span></li>)}</ul></div>}
    </section>
  </div>
}
