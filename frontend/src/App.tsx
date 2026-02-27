import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HelmetProvider } from "react-helmet-async";
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/wagmi'
import { AuthProvider } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Home from './pages/Home'
import Logs from './pages/Logs'
import ConnectForm from './components/ConnectForm'
import OAuthCallback from './components/OAuthCallback'
import VerifyEmail from './pages/VerifyEmail'
import Admin from './pages/Admin'
import BanVoting from './pages/BanVoting'
import BanVotingTimingPlan from './pages/BanVotingTimingPlan'
import UserAuditLog from './pages/UserAuditLog'
import Treasury from './pages/Treasury'
import SocialShareButtons from './components/SocialShareButtons'
import './App.css'

const queryClient = new QueryClient()

function App() {
  const testVar = import.meta.env.VITE_TEST_INSTANCE;
  console.log(`VITE_TEST_INSTANCE=${testVar}`); // TODO@P3: Remove this.
  const isTest = testVar === 'true';
  return (
    <HelmetProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
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
                      <Route path="/connect" element={<ConnectForm />} />
                      <Route path="/verify-email" element={<VerifyEmail />} />
                      <Route path="/admin" element={<Admin />} />
                      <Route path="/ban-voting" element={<BanVoting />} />
                      <Route path="/ban-voting/timing-plan" element={<BanVotingTimingPlan />} />
                      <Route path="/treasury" element={<Treasury />} />
                      {/* Redirect old login route to new connect route */}
                      <Route path="/login" element={<Navigate to="/connect" replace />} />
                      <Route path="/auth/github/callback" element={<OAuthCallback provider="github" />} />
                      <Route path="/auth/orcid/callback" element={<OAuthCallback provider="orcid" />} />
                      <Route path="/auth/bitbucket/callback" element={<OAuthCallback provider="bitbucket" />} />
                      <Route path="/auth/gitlab/callback" element={<OAuthCallback provider="gitlab" />} />
                    </Routes>
                  </main>
                  <footer>
                    <SocialShareButtons
                      title="Meritocracy DAO"
                      text="Meritocracy funds scientists and open-source developers through transparent AI-assisted governance."
                    />
                    <p data-nosnippet="data-nosnippet">
                      <a href="https://science-dao.org/terms-of-use/">Terms of Use</a> |{"  "}
                      <a href="https://science-dao.org/privacy-policy/">Privacy Policy</a> |{"  "}
                      <a href="https://science-dao.org/contact/">Contact</a> |{"  "}
                      <a href="https://github.com/vporton/meritocracy" title="Meritocracy on GitHub">
                        <img src="/github-mark.svg" alt="GitHub" width="20" height="20" style={{ verticalAlign: 'middle' }} />
                        <span style={{ marginLeft: '0.25rem' }}>GitHub</span>
                      </a>
                    </p>
                  </footer>
                </div>
              </div>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </HelmetProvider>
  )
}

export default App
