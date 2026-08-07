import { Helmet } from 'react-helmet-async'
import MultiNetworkGasBalances from '../components/MultiNetworkGasBalances'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'

export default function Treasury() {
  const frontendOrigin = getFrontendOrigin()
  return (
    <div>
      <Helmet>
        <title>Treasury - Meritocracy App</title>
        <meta name="description" content="Treasury balances and gas information for Meritocracy." />
      </Helmet>
      <Canonical baseUrl={frontendOrigin} />
      <h1>Treasury of the Meritocracy App <span style={{ color: 'red' }}>⚠️This is a beta version</span></h1>
      <p>This page shows token reserves across supported networks and lets you fund the treasury from a browser wallet when the network supports it.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' rel="noopener noreferrer" href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <p>WARNING: These addresses support only gas tokens and ckBTC, ckETH, and ck stablecoins. For ckETH and ck stablecoins, use the helper contract flow shown on this page. Don't send arbitrary ERC-20 tokens.</p>
      <MultiNetworkGasBalances />
    </div>
  )
}
