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
      <p>This page shows token reserves across supported networks and allows you to fill the reserves by sending crypto directly to the blockchain accounts.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <p>WARNING: These addresses support only gas tokens and ckBTC, ckETH, and ck stablecoins. Don't send ERC-20 tokens.</p>
      <MultiNetworkGasBalances />
    </div>
  )
}
