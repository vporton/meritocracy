import { useEffect, useMemo, useState } from 'react'
import { Actor } from '@icp-sdk/core/agent'
import { IDL } from '@icp-sdk/core/candid'
import { Principal } from '@icp-sdk/core/principal'
import type { Account, AssetId } from '../declarations/vault/vault.did'
import { countries } from '../utils/countries'
import { createIcActors } from '../ic/client'
import { formatAtoms } from '../ic/format'
import { sha256Text } from '../ic/hash'

type TreasuryCurrency = {
  network: string
  name: string
  symbol: string
  asset?: AssetId
}

const icrc = (network: string, name: string, symbol: string, decimals: number, ledger: string): TreasuryCurrency => ({
  network,
  name,
  symbol,
  asset: { ledger: Principal.fromText(ledger), symbol, decimals },
})

// Complete production-currency catalog inherited from the legacy treasury.
// ICRC assets have governed vault accounts now; the remaining networks stay
// visible while their Stage 9 canister adapters are pending.
const currencies: readonly TreasuryCurrency[] = [
  icrc('Internet Computer', 'Internet Computer', 'ICP', 8, 'ryjl3-tyaaa-aaaaa-aaaba-cai'),
  icrc('Internet Computer', 'Chain-key Bitcoin', 'ckBTC', 8, 'mxzaz-hqaaa-aaaar-qaada-cai'),
  icrc('Internet Computer', 'Chain-key Ether', 'ckETH', 18, 'ss2fx-dyaaa-aaaar-qacoq-cai'),
  icrc('Internet Computer', 'Chain-key Tether USD', 'ckUSDT', 6, 'cngnf-vqaaa-aaaar-qag4q-cai'),
  icrc('Internet Computer', 'Chain-key USD Coin', 'ckUSDC', 6, 'xevnm-gaaaa-aaaar-qafnq-cai'),
  icrc('Internet Computer', 'Chain-key Euro Coin', 'ckEURC', 6, 'pe5t5-diaaa-aaaar-qahwa-cai'),
  { network: 'Bitcoin', name: 'Bitcoin', symbol: 'BTC' },
  { network: 'Bitcoin Cash', name: 'Bitcoin Cash', symbol: 'BCH' },
  { network: 'Ethereum', name: 'Ether', symbol: 'ETH' },
  { network: 'Polygon', name: 'Polygon', symbol: 'POL' },
  { network: 'Arbitrum', name: 'Ether', symbol: 'ETH' },
  { network: 'Optimism', name: 'Ether', symbol: 'ETH' },
  { network: 'Base', name: 'Ether', symbol: 'ETH' },
  { network: 'Celo', name: 'Celo', symbol: 'CELO' },
  { network: 'Mezo', name: 'Bitcoin', symbol: 'BTC' },
  { network: 'Hedera', name: 'Hedera', symbol: 'HBAR' },
  { network: 'Solana', name: 'Solana', symbol: 'SOL' },
  { network: 'Polkadot', name: 'Polkadot', symbol: 'DOT' },
  { network: 'Cosmos Hub', name: 'Cosmos', symbol: 'ATOM' },
  { network: 'Stellar', name: 'Stellar', symbol: 'XLM' },
]

type IcrcLedger = { icrc1_balance_of: (account: Account) => Promise<bigint> }
const icrcLedgerIdl: IDL.InterfaceFactory = ({ IDL: Candid }) => Candid.Service({
  icrc1_balance_of: Candid.Func([
    Candid.Record({ owner: Candid.Principal, subaccount: Candid.Opt(Candid.Vec(Candid.Nat8)) }),
  ], [Candid.Nat], ['query']),
})

const hex = (value: Uint8Array | number[]) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')

const accountText = (account: Account) => {
  const subaccount = account.subaccount[0]
  return subaccount ? `${account.owner.toText()}:${hex(subaccount)}` : account.owner.toText()
}

export default function CanisterTreasuryBalances() {
  const [fund, setFund] = useState('MAIN')
  const [accounts, setAccounts] = useState<Record<string, Account>>({})
  const [amounts, setAmounts] = useState<Record<string, bigint>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fundLabel = fund === 'MAIN' ? 'Main fund' : fund === 'EU' ? 'European Union fund' : `${countries.find(({ code }) => code === fund)?.name ?? fund} fund`
  const fundKey = useMemo(() => fund === 'MAIN' ? 'main' : fund === 'EU' ? 'region:EU' : `country:${fund}`, [fund])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void Promise.all([createIcActors(), sha256Text(`meritocracy/treasury-fund/v1/${fundKey}`)]).then(async ([actors, fundHash]) => {
      const derived = await Promise.all(currencies.map(async (currency) => {
        if (!currency.asset) return undefined
        const account = await actors.vault.derive_round_account({ asset: currency.asset, fund: fundHash, round_id: 0n })
        const ledger = Actor.createActor<IcrcLedger>(icrcLedgerIdl, { agent: actors.agent, canisterId: currency.asset.ledger })
        let amount = 0n
        try {
          amount = await ledger.icrc1_balance_of(account)
        } catch {
          // A fresh local replica does not contain the mainnet ledger canisters;
          // its deterministic treasury accounts therefore start at zero.
        }
        return [currency.symbol, account, amount] as const
      }))
      if (active) {
        const available = derived.filter((entry): entry is readonly [string, Account, bigint] => entry !== undefined)
        setAccounts(Object.fromEntries(available.map(([symbol, account]) => [symbol, account])))
        setAmounts(Object.fromEntries(available.map(([symbol, , amount]) => [symbol, amount])))
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [fundKey])

  return <section>
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end', marginBottom: '1rem' }}>
      <label>Fund<br /><select value={fund} onChange={(event) => setFund(event.target.value)}>
        <option value="MAIN">Main fund</option>
        <option value="EU">European Union</option>
        {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
      </select></label>
    </div>
    <h2>{fundLabel} cryptocurrencies</h2>
    {error && <p role="alert">Failed to derive vault accounts: {error}</p>}
    {loading && <p role="status">Deriving deterministic accounts from the vault canister…</p>}
    <div style={{ overflowX: 'auto' }}><table>
      <thead><tr><th>Network</th><th>Cryptocurrency</th><th>Symbol</th><th>Vault account</th><th>Amount</th></tr></thead>
      <tbody>{currencies.map((currency, index) => {
        const account = currency.asset ? accounts[currency.symbol] : undefined
        return <tr key={`${currency.network}-${currency.symbol}-${index}`}>
          <td>{currency.network}</td><td>{currency.name}</td><td>{currency.symbol}</td>
          <td><code>{account ? accountText(account) : '—'}</code></td>
          <td>{currency.asset ? `${formatAtoms(amounts[currency.symbol] ?? 0n, currency.asset.decimals)} ${currency.symbol}` : `0 ${currency.symbol}`}</td>
        </tr>
      })}</tbody>
    </table></div>
  </section>
}
