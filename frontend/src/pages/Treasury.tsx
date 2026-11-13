import { Helmet } from 'react-helmet-async'
import MultiNetworkGasBalances from '../components/MultiNetworkGasBalances'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'
import type { MultiNetworkStatus } from '../components/MultiNetworkGasBalances'

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
      <h1>SciWard Treasury</h1>
      <p style={{ color: 'red' }}>This is a beta version.</p>
      <p>This page shows token reserves across supported networks and lets you fund the treasury from a browser wallet when the network supports it.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <p>WARNING: These addresses support only gas tokens and ckBTC, ckETH, and ck stablecoins. For ckETH and ck stablecoins, use the helper contract flow shown on this page. Don't send arbitrary ERC-20 tokens.</p>
      <noscript>
        <p>The network list and treasury deposit addresses below are a server-generated snapshot. Enable JavaScript to refresh live balances and gas prices or to use browser-wallet funding.</p>
      </noscript>
      <MultiNetworkGasBalances initialStatus={initialStatus} />
    </div>
  )
}
