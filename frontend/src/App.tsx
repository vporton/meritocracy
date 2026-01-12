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
import './App.css'
import Canonical from './components/Canonical';

const queryClient = new QueryClient()

function App() {
  return (
    <HelmetProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Canonical baseUrl="https://merit.science-dao.org" />
              <div className="App">
                <Navigation />
                <main>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/connect" element={<ConnectForm />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    {/* Redirect old login route to new connect route */}
                    <Route path="/login" element={<Navigate to="/connect" replace />} />
                    <Route path="/auth/github/callback" element={<OAuthCallback provider="github" />} />
                    <Route path="/auth/orcid/callback" element={<OAuthCallback provider="orcid" />} />
                    <Route path="/auth/bitbucket/callback" element={<OAuthCallback provider="bitbucket" />} />
                    <Route path="/auth/gitlab/callback" element={<OAuthCallback provider="gitlab" />} />
                  </Routes>
                </main>
              </div>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </HelmetProvider>
  )
}

export default App
