import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import MultiNetworkGasBalances from '../components/MultiNetworkGasBalances'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'
import type { MultiNetworkStatus } from '../components/MultiNetworkGasBalances'
import './Treasury.css'

interface TreasuryProps {
  initialStatus?: MultiNetworkStatus
}

export default function Treasury({ initialStatus }: TreasuryProps) {
  const frontendOrigin = getFrontendOrigin()
  return (
    <div>
      <Helmet>
        <title>SciWard Treasury – Multi-Chain Donation Wallets &amp; Balances</title>
        <meta name="description" content="Live SciWard treasury balances, gas prices and donation addresses for 21 networks and tokens, including Ethereum, Bitcoin, Solana and ICP ckTokens." />
      </Helmet>
      <Canonical baseUrl={frontendOrigin} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span aria-hidden="true"> &gt; </span>
        <span aria-current="page">Treasury</span>
      </nav>
      <h1>SciWard Treasury</h1>
      <p style={{ color: 'red' }}>This is a beta version.</p>
      <p>The treasury is SciWard’s shared pool of donated crypto, held across the supported networks shown below and used to fund the program. It is controlled by SciWard’s AI-assisted governance: the AI evaluates users’ published research and open-source work, while community voters can oversee decisions and remove accounts involved in abuse. Funds are paid out weekly to users who have completed evaluation and remain eligible, in proportions set by their evaluated contribution. Each evaluation is intended to be inspectable; browse the public <Link to="/user-audit-logs">Audit Logs</Link> to see the evidence and reasoning behind user assessments.</p>
      <p>This page shows token reserves across supported networks and lets you fund the treasury from a browser wallet when the network supports it.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <aside className="treasury-token-notice" aria-labelledby="token-notice-heading">
        <h2 id="token-notice-heading">Token deposit notice</h2>
        <p>Only send a supported token using the deposit instructions for that network. Sending an arbitrary ERC-20 token may result in permanent loss.</p>
        <dl>
          <div>
            <dt>Which tokens are supported?</dt>
            <dd>Network gas tokens, ckBTC, ckETH, and ck stablecoins. For ckETH and ck stablecoins, use the helper-contract flow shown below.</dd>
          </div>
          <div>
            <dt>What if I send the wrong token?</dt>
            <dd>It may be lost and might not be recoverable. Contact us before sending if you are unsure.</dd>
          </div>
        </dl>
      </aside>
      <noscript>
        <p>The network list and treasury deposit addresses below are a server-generated snapshot. Enable JavaScript to refresh live balances and gas prices or to use browser-wallet funding.</p>
      </noscript>
      <MultiNetworkGasBalances initialStatus={initialStatus} />
    </div>
  )
}
