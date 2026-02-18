import { Helmet } from 'react-helmet-async'
import MultiNetworkGasBalances from '../components/MultiNetworkGasBalances'

export default function Treasury() {
  return (
    <div>
      <Helmet>
        <title>Treasury - Meritocracy App</title>
        <meta name="description" content="Treasury balances and gas information for Meritocracy." />
      </Helmet>
      <h1>Treasury of the Meritocracy App <span style={{ color: 'red' }}>⚠️This is a beta version</span></h1>
      <p>This page shows token reserves across supported networks and allows to fill the reserves by sending crypto directly to the blockchain accounts.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <MultiNetworkGasBalances />
    </div>
  )
}
