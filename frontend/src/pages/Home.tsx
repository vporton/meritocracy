import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { usersApi } from '../services/api'
import { ethers } from 'ethers'
import Leaderboard from '../components/Leaderboard'
import { useAuth } from '../contexts/AuthContext'

interface ServerStatus {
  status?: string;
  version?: string;
  message?: string;
  error?: string;
}

interface WorldGdpData {
  worldGdp: number;
  formatted: string;
  currency: string;
  lastUpdated: string;
}

interface UserGdpShareData {
  userId: number;
  name?: string;
  email?: string;
  shareInGDP: number | null;
  formatted?: string;
}

function Home() {
  const { user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [ethereumStatus, setEthereumStatus] = useState<{network: string, balance: bigint, currency: string, address?: string} | undefined>()
  const [worldGdp, setWorldGdp] = useState<WorldGdpData | null>(null)
  const [userGdpShare, setUserGdpShare] = useState<UserGdpShareData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copySuccess, setCopySuccess] = useState(false)
  const [onboardingLoading, setOnboardingLoading] = useState(false)

  useEffect(() => {
    const checkServerStatus = async () => {
      try {
        const response = await api.get('/')
        setServerStatus(response.data)
      } catch (error) {
        setServerStatus({ error: 'Failed to connect to server' })
      } finally {
        setLoading(false)
      }
    }

    checkServerStatus()
  }, [])

  useEffect(() => {
    const checkEthereumStatus = async () => {
      try {
        const response = await api.get('/api/ethereum/wallet-info')
        const data = response.data.data
        setEthereumStatus({
          network: data.network,
          balance: BigInt(data.balance),
          currency: data.currency,
          address: data.address
        })
      } catch (error) {
        // setEthereumStatus({ error: 'Failed to connect to server' })
      } finally {
        // setLoading(false) // TODO
      }
    }

    checkEthereumStatus()
  }, [])

  useEffect(() => {
    const fetchWorldGdp = async () => {
      try {
        const response = await api.get('/api/global/gdp')
        if (response.data.success) {
          setWorldGdp(response.data.data)
        }
      } catch (error) {
        console.error('Failed to fetch world GDP:', error)
      }
    }

    fetchWorldGdp()
  }, [])

  useEffect(() => {
    const fetchUserGdpShare = async () => {
      try {
        const response = await usersApi.getMyGdpShare()
        if (response.data.success) {
          setUserGdpShare(response.data.data || null)
        }
      } catch (error) {
        console.error('Failed to fetch user GDP share:', error)
        // Don't set error state for this as it's optional and might fail if user is not authenticated
      }
    }

    fetchUserGdpShare()
  }, [])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
      } catch (fallbackErr) {
        console.error('Fallback copy failed: ', fallbackErr)
      }
      document.body.removeChild(textArea)
    }
  }

  const handleStartOnboarding = async () => {
    if (!user || !isAuthenticated) {
      alert('Please connect your accounts first before starting onboarding.')
      return
    }

    setOnboardingLoading(true)
    try {
      // Start the onboarding flow
      const response = await api.post('/api/evaluation/start', {
        userId: user.id,
        userData: {
          orcidId: user.orcidId,
          githubHandle: user.githubHandle,
          bitbucketHandle: user.bitbucketHandle,
          gitlabHandle: user.gitlabHandle,
        }
      })

      if (response.data.success) {
        // Redirect to logs page to see the progress
        navigate('/logs')
      } else {
        alert('Failed to start onboarding. Please try again.')
      }
    } catch (error) {
      console.error('Onboarding error:', error)
      alert('Failed to start onboarding. Please try again.')
    } finally {
      setOnboardingLoading(false)
    }
  }

  const hasConnectedAccounts = () => {
    if (!user) return false
    return !!(user.orcidId || user.githubHandle || user.bitbucketHandle || user.gitlabHandle || user.ethereumAddress)
  }

  if (loading) {
    return <div className="loading">Checking server status...</div>
  }

  return (
    <div>
      <h1>Welcome to Socialism App <span style={{ color: 'red' }}>⚠️This is a test version</span></h1>
      <p>After you connect your accounts, this app asks AI to analyze your works and assigns you a weekly payment, if you are a scientist or free software developer. The service is entirely free for you, you even don't pay blockchain gas fees.</p>
      <div className="card">
        <h3>Server Status</h3>
        {serverStatus?.error ? (
          <div className="error">
            ❌ {serverStatus.error}
            <br />
            <small>Make sure the backend server is running on port 3001</small>
          </div>
        ) : (
          <div>
            <p>✅ <strong>Status:</strong> {serverStatus?.status}</p>
            <p>📦 <strong>Version:</strong> {serverStatus?.version}</p>
          </div>
        )}
      </div>
      <div className="card">
        <p>✅ <strong>EVM network:</strong> {ethereumStatus?.network}</p>
        <p>📦 <strong>EVM gas token balance:</strong> {ethereumStatus ? ethers.formatEther(ethereumStatus.balance) : "n/a"} {ethereumStatus?.currency}</p>
      </div>
      
      <div className="card">
        <h3>🌍 World Economy</h3>
        {worldGdp ? (
          <div>
            <p>💰 <strong>World GDP:</strong> {worldGdp.formatted} {worldGdp.currency}</p>
            <p style={{ fontSize: '0.9rem', color: '#888' }}>
              Last updated: {new Date(worldGdp.lastUpdated).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p>📊 <strong>World GDP:</strong> Data not available</p>
        )}
      </div>

      {userGdpShare && (
        <div className="card">
          <h3>💼 Your Economic Share</h3>
          {userGdpShare.shareInGDP !== null ? (
            <div>
              <p>🎯 <strong>Your GDP Share:</strong> {userGdpShare.formatted || `$${userGdpShare.shareInGDP.toLocaleString()}`}</p>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                This represents your calculated portion of the world economy based on your contributions
              </p>
            </div>
          ) : (
            <div>
              <p>⏳ <strong>Your GDP Share:</strong> Not yet calculated</p>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                Complete your profile and evaluation to receive your economic share calculation
              </p>
            </div>
          )}
        </div>
      )}

      <Leaderboard limit={100} showTop={10} />
      
      {/* Onboarding Section */}
      {isAuthenticated && user && (
        <div className="card">
          <h3>🚀 Start Your Evaluation</h3>
          {hasConnectedAccounts() ? (
            <div>
              <p>✅ You have connected accounts and are ready to start your evaluation!</p>
              <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem' }}>
                Click the button below to begin the AI analysis of your contributions and receive your GDP share calculation.
              </p>
              <button
                onClick={handleStartOnboarding}
                disabled={onboardingLoading}
                style={{
                  background: onboardingLoading ? '#666' : '#4caf50',
                  border: 'none',
                  color: 'white',
                  padding: '1rem 2rem',
                  borderRadius: '8px',
                  cursor: onboardingLoading ? 'not-allowed' : 'pointer',
                  fontSize: '1.1rem',
                  fontWeight: 'bold',
                  transition: 'background-color 0.25s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  margin: '0 auto'
                }}
              >
                {onboardingLoading ? (
                  <>
                    <div className="loading" style={{ margin: 0, fontSize: '0.9rem' }}>⏳</div>
                    Starting Evaluation...
                  </>
                ) : (
                  <>
                    🚀 Start Evaluation
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              <p>⚠️ <strong>Please connect all your accounts first!</strong></p>
              <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem' }}>
                You need to connect your accounts (GitHub, ORCID, BitBucket, GitLab, etc.) before starting the evaluation process. 
                This allows our AI to analyze your contributions and calculate your fair share of the world economy.
              </p>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                Go to the <a href="/connect" style={{ color: '#646cff' }}>Connect</a> page to link your accounts.
              </p>
            </div>
          )}
        </div>
      )}
      
      {ethereumStatus?.address && (
        <div className="card">
          <h3>💖 Support This Project</h3>
          <p>Help support the development of this open-source project by donating Ethereum or ERC-20 tokens:</p>
          <div style={{ 
            background: '#2a2a2a', 
            padding: '1rem', 
            borderRadius: '8px', 
            border: '1px solid #333',
            margin: '1rem 0',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            wordBreak: 'break-all',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <span style={{ flex: 1, color: '#ffffff' }}>
              {ethereumStatus.address}
            </span>
            <button 
              onClick={() => copyToClipboard(ethereumStatus.address!)}
              style={{
                background: copySuccess ? '#4caf50' : '#646cff',
                border: 'none',
                color: 'white',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                whiteSpace: 'nowrap',
                transition: 'background-color 0.25s'
              }}
            >
              {copySuccess ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
          <p style={{ fontSize: '0.9rem', color: '#888' }}>
            This address accepts ETH and all ERC-20 tokens on {ethereumStatus.network}
          </p>
        </div>
      )}
    </div>
  )
}

export default Home
