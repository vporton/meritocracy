import { Helmet } from 'react-helmet-async'
import MultiNetworkGasBalances from '../components/MultiNetworkGasBalances'

export default function Treasury() {
  return (
    <div>
      <Helmet>
        <title>Treasury - Meritocracy App</title>
        <meta name="description" content="Treasury balances and gas information for Meritocracy." />
      </Helmet>
      <h1>Treasury</h1>
      <p>Review treasury balances and gas reserves across supported networks.</p>
      <MultiNetworkGasBalances />
    </div>
  )
}
