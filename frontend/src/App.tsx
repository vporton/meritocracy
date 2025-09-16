import { Routes, Route, Navigate } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './config/wagmi'
import { AuthProvider } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Home from './pages/Home'
import Logs from './pages/Logs'
import ConnectForm from './components/ConnectForm'
import OAuthCallback from './components/OAuthCallback'
import './App.css'

const queryClient = new QueryClient()

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <div className="App">
            <Navigation />
            <main>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/connect" element={<ConnectForm />} />
                {/* Redirect old login route to new connect route */}
                <Route path="/login" element={<Navigate to="/connect" replace />} />
                <Route path={`${import.meta.env.VITE_API_URL}/auth/github/callback`} element={<OAuthCallback provider="github" />} />
                <Route path={`${import.meta.env.VITE_API_URL}/auth/orcid/callback`} element={<OAuthCallback provider="orcid" />} />
                <Route path={`${import.meta.env.VITE_API_URL}/auth/bitbucket/callback`} element={<OAuthCallback provider="bitbucket" />} />
                <Route path={`${import.meta.env.VITE_API_URL}/auth/gitlab/callback`} element={<OAuthCallback provider="gitlab" />} />
              </Routes>
            </main>
          </div>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default App
