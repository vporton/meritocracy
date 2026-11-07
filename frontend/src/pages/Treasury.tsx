import { Helmet } from 'react-helmet-async'
import CanisterTreasuryBalances from '../components/CanisterTreasuryBalances'
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
      <p>This page shows the cryptocurrency accounts for the main treasury fund and deterministic country funds.</p>
      <p>However, the recommended way to fill the accounts is to <a target='_blank' href='https://science-dao.org/donation/'>donate</a> to our charity, rather than to fill accounts directly.</p>
      <p>WARNING: Send funds only where an account is marked ready. Other cryptocurrencies are listed for transparency but remain disabled until their canister adapters are implemented and reviewed.</p>
      <CanisterTreasuryBalances />
    </div>
  )
}
