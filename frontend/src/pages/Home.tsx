import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api, { usersApi } from '../services/api'
import Leaderboard from '../components/Leaderboard'
import { useAuth } from '../contexts/AuthContext'
import { Helmet } from 'react-helmet-async'
import Canonical from '../components/Canonical'
import { text } from 'stream/consumers'

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

export default function Home() {
  const { user, isAuthenticated, refreshUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [primaryNetworkAddress, setPrimaryNetworkAddress] = useState<string | null>(null)
  const [worldGdp, setWorldGdp] = useState<WorldGdpData | null>(null)
  const [userGdpShare, setUserGdpShare] = useState<UserGdpShareData | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [showOnboardingConfirm, setShowOnboardingConfirm] = useState(false)

  useEffect(() => {
    const fetchPrimaryNetworkAddress = async () => {
      try {
        // Try to get the primary network address from multi-network list (lighter than status)
        const response = await api.get('/api/multi-network-gas/list')
        if (response.data.success && response.data.data.networkDetails && response.data.data.networkDetails.length > 0) {
          const firstNetwork = response.data.data.networkDetails[0]
          if (firstNetwork?.walletAddress) {
            setPrimaryNetworkAddress(firstNetwork.walletAddress)
          }
        }
      } catch (error) {
        console.log('Failed to fetch network address:', error)
      }
    }

    fetchPrimaryNetworkAddress()
  }, [])

  // TODO@P3: duplicate code
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
      if (!isAuthenticated) return;

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
  }, [isAuthenticated])

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

    // Show confirmation dialog
    setShowOnboardingConfirm(true)
  }

  const confirmOnboarding = async () => {
    if (!user || !isAuthenticated) {
      return
    }

    setShowOnboardingConfirm(false)
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
          ethereumAddress: user.ethereumAddress,
          email: user.email,
          emailVerified: user.emailVerified,
        }
      })

      if (response.data.success) {
        try {
          await refreshUser()
        } catch (err) {
          console.error('Failed to refresh user after starting evaluation:', err)
        }
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

  const cancelOnboarding = () => {
    setShowOnboardingConfirm(false)
  }

  const hasConnectedAccounts = () => {
    if (!user) return false
    const hasSocial = !!(user.orcidId || user.githubHandle || user.bitbucketHandle || user.gitlabHandle)
    const hasEmail = !!(user.email && user.emailVerified)
    const hasEth = !!user.ethereumAddress

    if (import.meta.env.DEV) {
      return hasEmail && hasEth
    }

    return hasSocial && hasEmail && hasEth
  }

  const hasKycVerification = () => {
    if (!user) return false
    return user.kycStatus === 'APPROVED'
  }

  useEffect(() => {
    console.log(
      '[Home] user onboarded:', user?.onboarded,
      'isAuthenticated:', isAuthenticated,
      'path:', window.location.pathname
    )
  }, [user?.onboarded, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && location.pathname === '/') {
      refreshUser().catch(err => console.error('Failed to refresh user on home navigation:', err))
    }
  }, [isAuthenticated, location.pathname, refreshUser])

  return (
    <div>
      <Helmet>
        <title>Meritocracy DAO – Funding Scientists & Open-Source</title>
        <meta name="description" content="Meritocracy is a DeSci DAO that funds scientists and open-source developers through transparent governance. " />
        <script type="application/ld+json">
        {`
{
  "@context": "https://schema.org",
  "@graph": [
   {
      "@type": "Organization",
      "@id": "https://merit.science-dao.org/#organization",
      "name": "Meritocracy",
      "url": "https://merit.science-dao.org",
      "description": "A decentralized science (DeSci) DAO that funds scientists and open-source developers through transparent governance.",
      "logo": "https://merit.science-dao.org/logo.png",
      "sameAs": [
        "https://science-dao.org"
      ]
    },
    {
      "@type": "WebSite",
      "@id": "https://merit.science-dao.org/#website",
      "url": "https://merit.science-dao.org",
      "name": "Meritocracy DAO",
      "description": "A decentralized funding platform for scientists and open-source developers.",
      "publisher": {
        "@id": "https://merit.science-dao.org/#organization"
      }
    },
    {
      "@type": "WebPage",
      "@id": "https://merit.science-dao.org/#webpage",
      "url": "https://merit.science-dao.org",
      "name": "Meritocracy: DAO for Funding Scientists and Open-Source Developers",
      "description": "Meritocracy is a decentralized science DAO that distributes funding to scientists and open-source developers based on measurable contributions.",
      "isPartOf": {
        "@id": "https://merit.science-dao.org/#website"
      },
      "about": {
        "@id": "https://merit.science-dao.org/#software"
      }
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://merit.science-dao.org/#software",
      "name": "Meritocracy",
      "applicationCategory": "BlockchainApplication",
      "operatingSystem": "Web",
      "url": "https://merit.science-dao.org",
      "description": "A decentralized science DAO platform that funds scientists and open-source developers through transparent governance and voting.",
      "creator": {
        "@id": "https://merit.science-dao.org/#organization"
      },
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    }
  ]
}`}
        </script>
      </Helmet>
      <Canonical baseUrl="https://merit.science-dao.org" />
      <h1>Meritocracy: A DAO<sup><a href='https://science-dao.org/dao-status/'>*</a></sup> for Funding Scientists and Open-Source Developers</h1>
      <p>Meritocracy is a decentralized science (DeSci) DAO that distributes funding to scientists and open-source developers based on measurable contributions. The system uses transparent voting, reputation signals, and on-chain records to allocate resources without traditional grant committees.</p>
      <p>After you connect your accounts, this app asks AI to analyze your works and assigns you a weekly payment, if you are a scientist or free software developer. The service is entirely free for you, you even don't pay blockchain gas fees.</p>
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
              <p>🎯 <strong>Your Recommended (yearly) Salary:</strong>{" "}
                {userGdpShare.shareInGDP.toString()}{" = "}
                {worldGdp ? `$${(userGdpShare.shareInGDP * worldGdp.worldGdp).toLocaleString()}` : "Calculating..."}</p>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                This represents your calculated portion of the world economy based on your contributions
              </p>
            </div>
          ) : (
            <div>
              <p>⏳ <strong>Your Recommended (yearly) Salary:</strong> Not yet calculated</p>
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
          {user.onboarded ? (
            <div style={{
              padding: '1rem',
              background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
              borderRadius: '8px',
              borderLeft: '4px solid #f59e0b',
              marginBottom: '1rem'
            }}>
              <p style={{ margin: 0, color: '#92400e', fontWeight: '600' }}>
                🎉 <strong>You have already been onboarded!</strong>
              </p>
              <p style={{ margin: '0.5rem 0 0 0', color: '#92400e', fontSize: '0.9rem' }}>
                Your evaluation process has been completed. You can view your progress and results in the <a href="/logs" style={{ color: '#b45309', textDecoration: 'underline' }}>Logs</a> page.
              </p>
            </div>
          ) : hasConnectedAccounts() ? (
            <div>
              {/* Prominent warning about connecting accounts */}
              <div style={{
                padding: '1rem',
                background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                borderRadius: '8px',
                borderLeft: '4px solid #ef4444',
                marginBottom: '1.5rem'
              }}>
                <p style={{ margin: 0, color: '#dc2626', fontWeight: '600', fontSize: '1rem' }}>
                  ⚠️ <strong>IMPORTANT: Connect Your Accounts First!</strong>
                </p>
                <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
                  To start evaluation, you MUST connect <strong>Ethereum</strong>, <strong>email (verified)</strong>{import.meta.env.DEV ? ' (Social connection is optional in dev mode)' : <>, and at least <strong>one</strong> of the following: <strong>ORCID, GitHub, BitBucket, GitLab</strong></>}.
                </p>
                <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
                  Make sure to connect these on the <a href="/connect" style={{ color: '#b91c1c', textDecoration: 'underline', fontWeight: '600' }}>Connect page</a> before proceeding.
                </p>
              </div>

              {!hasKycVerification() && (
                <div style={{
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
                  borderRadius: '8px',
                  borderLeft: '4px solid #0ea5e9',
                  marginBottom: '1.5rem'
                }}>
                  <p style={{ margin: 0, color: '#0369a1', fontWeight: '600', fontSize: '1rem' }}>
                    🆔 <strong>KYC Verification Notice</strong>
                  </p>
                  <p style={{ margin: '0.5rem 0 0 0', color: '#0369a1', fontSize: '0.9rem' }}>
                    You can start your evaluation now without KYC.
                  </p>
                  <p style={{ margin: '0.5rem 0 0 0', color: '#0369a1', fontSize: '0.9rem' }}>
                    However, you will be required to complete KYC later to receive payments once they are allocated to you.
                  </p>
                </div>
              )}

              <p>
                {hasKycVerification()
                  ? "✅ You have connected accounts and completed KYC verification."
                  : "✅ You have connected accounts. You can start your evaluation now!"}
              </p>
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
              <p>⚠️ <strong>Please connect your accounts first!</strong></p>
              <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem' }}>
                To start evaluation, you MUST connect:
              </p>
              <ul style={{ fontSize: '0.9rem', color: '#888', textAlign: 'left', display: 'inline-block' }}>
                <li>Ethereum wallet</li>
                <li>Email address (and verify it)</li>
                <li>At least one of: ORCID, GitHub, BitBucket, or GitLab {import.meta.env.DEV && <span style={{ color: '#059669' }}>(Optional in development mode)</span>}
                  <span style={{ color: '#dc2626' }}>(Be sure to connect accounts where you works are presented <strong>before</strong> evaluation!)</span></li>
              </ul>
              <p style={{ fontSize: '0.9rem', color: '#888', marginTop: '1rem' }}>
                Go to the <a href="/connect" style={{ color: '#646cff' }}>Connect</a> page to link your accounts.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Onboarding Confirmation Dialog */}
      {showOnboardingConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>
              ⚠️ Confirm Onboarding Start
            </h3>
            <div style={{
              padding: '1rem',
              background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
              borderRadius: '8px',
              borderLeft: '4px solid #ef4444',
              marginBottom: '1.5rem'
            }}>
              <p style={{ margin: 0, color: '#dc2626', fontWeight: '600' }}>
                <strong>IMPORTANT REMINDER:</strong>
              </p>
              <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
                Have you connected <strong>Ethereum</strong> and <strong>email</strong>{import.meta.env.DEV ? '?' : <>, and at least <strong>one</strong> of: <strong>ORCID, GitHub, BitBucket, GitLab?</strong></>}
              </p>
              <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
                {hasKycVerification()
                  ? "✅ KYC verification is complete."
                  : "ℹ️ KYC verification is NOT yet complete. You can proceed with evaluation, but you will need to complete KYC later to receive payments."}
              </p>
            </div>
            <p style={{ margin: '0 0 1.5rem 0', color: '#666' }}>
              Are you sure you want to start the evaluation process now?
              You can still connect additional accounts later, but it may delay your salary calculation.
            </p>
            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={cancelOnboarding}
                style={{
                  background: '#6b7280',
                  border: 'none',
                  color: 'white',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmOnboarding}
                disabled={onboardingLoading}
                style={{
                  background: onboardingLoading ? '#666' : '#ef4444',
                  border: 'none',
                  color: 'white',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '6px',
                  cursor: onboardingLoading ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                  fontWeight: '500'
                }}
              >
                {onboardingLoading ? 'Starting...' : 'Yes, Start Evaluation'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{textAlign: 'left'}}>
        <h2>What is AI Internet-Meritocracy?</h2>
        <p>Meritocracy is a decentralized science DAO that funds researchers through transparent governance.</p>
        <p>Meritocracy is:</p>
        <ul>
          <li>A decentralized funding platform</li>
          <li>Built as a DeSci DAO</li>
          <li>Focused on science and open-source software</li>
          <li>Governed by contributors instead of institutions</li>
        </ul>
        <h2>How Meritocracy Works</h2>
        <p>The app asks the AI, what portion of the global GDP a user is worth based on analyzing his/her Web accounts, and then gives him/her the proportional share of donated funds.</p>
        <h2>Who Can Apply</h2>
        <p>Everybody who has published any research or software can apply. Science degree is <em>not</em> required.</p>
        <h2>How Funding Decisions Are Made</h2>
        <p>Funding decisions are made by an AI, whose reasonings are transparently published in Audit Logs. AI is oversaw by voters to prevent scams such as prompt injections, banning a user.</p>
        <h2>About the Organization</h2>
        <p>Meritocracy is an initiative of World Science DAO, a decentralized organization working on open scientific funding models.</p>
      </div>
    </div>
  )
}
