import { BrowserRouter, StaticRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HelmetProvider } from "react-helmet-async";
import { WagmiProvider } from './lib/retiredWallet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Home from './pages/Home'
import Logs from './pages/Logs'
import ConnectForm from './components/ConnectForm'
import VerifyEmail from './pages/VerifyEmail'
import Admin from './pages/Admin'
import BanVoting from './pages/BanVoting'
import BanVotingTimingPlan from './pages/BanVotingTimingPlan'
import DefensePanel from './pages/DefensePanel'
import UserAuditLog from './pages/UserAuditLog'
import Treasury from './pages/Treasury'
import SocialShareButtons from './components/SocialShareButtons'
import './App.css'

type AppProps = {
  location?: string
  helmetContext?: Record<string, unknown>
}

function App({ location, helmetContext }: AppProps) {
  const testVar = import.meta.env.VITE_TEST_INSTANCE;
  const isTest = testVar === 'true';
  const queryClient = new QueryClient()
  const content = (
    <div className="App">
      <header>
        {isTest && <p style={{color: 'red'}}>This is a test installation.</p>}
        <Navigation />
      </header>
      <div className="page-container">
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/logs/:userId" element={<UserAuditLog />} />
            <Route path="/audit-log" element={<UserAuditLog />} />
            <Route path="/connect" element={<ConnectForm />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/ban-voting" element={<BanVoting />} />
            <Route path="/ban-voting/timing-plan" element={<BanVotingTimingPlan />} />
            <Route path="/timing-plan" element={<BanVotingTimingPlan />} />
            <Route path="/defense-panel" element={<DefensePanel />} />
            <Route path="/treasury" element={<Treasury />} />
            {/* Redirect old login route to new connect route */}
            <Route path="/login" element={<Navigate to="/connect" replace />} />
          </Routes>
        </main>
        <footer>
          <SocialShareButtons
            title="SciWard"
            text="SciWard funds scientists and open-source developers through transparent AI-assisted governance."
          />
          <p data-nosnippet="data-nosnippet">
            <a href="https://science-dao.org/terms-of-use/">Terms of Use</a> |{"  "}
            <a href="https://science-dao.org/privacy-policy/">Privacy Policy</a> |{"  "}
            <a href="https://science-dao.org/contact/">Contact</a> |{"  "}
            <a href="https://github.com/vporton/meritocracy/issues/new" target="_blank" rel="noopener noreferrer">Report a bug</a> |{"  "}
            <a href="https://github.com/vporton/meritocracy" title="SciWard on GitHub">
              <img src="/github-mark.svg" alt="GitHub" width="20" height="20" style={{ verticalAlign: 'middle' }} />
              <span style={{ marginLeft: '0.25rem' }}>GitHub</span>
            </a>
          </p>
        </footer>
      </div>
    </div>
  )

  return (
    <HelmetProvider context={helmetContext}>
      <WagmiProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {location
              ? <StaticRouter location={location}>{content}</StaticRouter>
              : <BrowserRouter>{content}</BrowserRouter>}
          </AuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </HelmetProvider>
  )
}

export default App
