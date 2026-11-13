import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import api, { usersApi, SalaryStats } from '../services/api'
import Leaderboard from '../components/Leaderboard'
import { useAuth } from '../contexts/AuthContext'
import { Helmet } from 'react-helmet-async'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'
import { useWorldGdp } from '../hooks/useWorldGdp'

interface UserGdpShareData {
  userId: number;
  name?: string;
  email?: string;
  shareInGDP: number | null;
  formatted?: string;
}

interface HomeProps {
  initialWorldGdp?: WorldGdpData
}

export default function Home({ initialWorldGdp }: HomeProps) {
  const frontendOrigin = getFrontendOrigin()
  const { user, isAuthenticated, refreshUser } = useAuth()
  const location = useLocation()
  const [primaryNetworkAddress, setPrimaryNetworkAddress] = useState<string | null>(null)
  const [userGdpShare, setUserGdpShare] = useState<UserGdpShareData | null>(null)
  const [salaryStats, setSalaryStats] = useState<SalaryStats | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const showEvaluationCTA = !user?.onboarded
  const worldGdp = useWorldGdp(initialWorldGdp ?? null)

  const formatUsd = (value: number) =>
    value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

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

  useEffect(() => {
    const fetchSalaryStats = async () => {
      try {
        const response = await usersApi.getSalaryStats()
        if (response.data.success) {
          setSalaryStats(response.data.data)
        }
      } catch (error) {
        console.error('Failed to fetch recommended salary stats:', error)
      }
    }

    fetchSalaryStats()
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
        <title>SciWard: AI Funding for Scientists &amp; Open-Source Developers</title>
        <meta name="description" content="Free AI-powered platform paying weekly crypto grants to scientists and open-source developers for measurable work. Connect your accounts for a free evaluation." />
        <script type="application/ld+json">
        {`
{
  "@context": "https://schema.org",
  "@graph": [
   {
      "@type": "Organization",
      "@id": "${frontendOrigin}/#organization",
      "name": "SciWard",
      "url": "${frontendOrigin}",
      "description": "An AI-powered funding platform for scientists and open-source developers.",
      "logo": "${frontendOrigin}/ward.png",
      "sameAs": [
        "https://science-dao.org"
      ]
    },
    {
      "@type": "WebSite",
      "@id": "${frontendOrigin}/#website",
      "url": "${frontendOrigin}",
      "name": "SciWard",
      "description": "A decentralized funding platform for scientists and open-source developers.",
      "publisher": {
        "@id": "${frontendOrigin}/#organization"
      }
    },
    {
      "@type": "WebPage",
      "@id": "${frontendOrigin}/#webpage",
      "url": "${frontendOrigin}",
      "name": "SciWard: Funding Scientists and Open-Source Developers",
      "description": "SciWard distributes funding to scientists and open-source developers based on measurable contributions.",
      "isPartOf": {
        "@id": "${frontendOrigin}/#website"
      },
      "about": {
        "@id": "${frontendOrigin}/#software"
      }
    },
    {
      "@type": "SoftwareApplication",
      "@id": "${frontendOrigin}/#software",
      "name": "SciWard",
      "applicationCategory": "BlockchainApplication",
      "operatingSystem": "Web",
      "url": "${frontendOrigin}",
      "description": "An AI-powered funding platform for scientists and open-source developers.",
      "creator": {
        "@id": "${frontendOrigin}/#organization"
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
      <Canonical baseUrl={frontendOrigin} />
      <h1>SciWard: Funding Scientists and Open-Source Developers</h1>
      <p>SciWard is an AI-powered funding platform that distributes donations to scientists and open-source developers based on measurable contributions.</p>
      <p>After you connect your accounts, this app asks AI to analyze your works and assigns you a weekly payment, if you are a scientist or free software developer. The service is entirely free for you, you even don't pay blockchain gas fees.</p>
      {showEvaluationCTA && (
        <div className="card evaluation-callout">
          <h2>Not yet evaluated? Get your share for free.</h2>
          <p>Connect your accounts, let AI review your contributions, and become eligible for receiving cryptocurrency grants—at no cost.</p>
          <Link to="/connect" className="evaluation-link">Start your free evaluation</Link>
        </div>
      )}
      <div className="card">
        <p><span aria-hidden="true">🌍</span> World Economy</p>
        {worldGdp ? (
          <div>
            <p><span aria-hidden="true">💰</span> <strong>World GDP:</strong> {worldGdp.formatted} {worldGdp.currency}</p>
            <p style={{ fontSize: '0.9rem', color: '#888' }}>
              Last updated: {new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              }).format(new Date(worldGdp.lastUpdated))}
            </p>
          </div>
        ) : (
          <p><span aria-hidden="true">📊</span>  <strong>World GDP:</strong> Data not available</p>
        )}
      </div>

      {salaryStats && (
        <div className="card">
          <h2><span aria-hidden="true">💹</span> Recommended Salaries (All Users)</h2>
          <p style={{ marginBottom: '0.25rem' }}>📈 <strong>Total recommended salary:</strong> {formatUsd(salaryStats.totalRecommendedSalary)} across {salaryStats.userCount} users</p>
          <p style={{ marginBottom: '0.25rem' }}>⚖️ <strong>Average recommended salary:</strong> {formatUsd(salaryStats.averageRecommendedSalary)}</p>
          <p><span aria-hidden="true">🧮</span> <strong>Median recommended salary:</strong> {formatUsd(salaryStats.medianRecommendedSalary)}</p>
        </div>
      )}
    
      {userGdpShare && (
        <div className="card">
          <h2><span aria-hidden="true">💼</span> Your Economic Share</h2>
          {userGdpShare.shareInGDP !== null ? (
            <div>
              <p><span aria-hidden="true">🎯</span> <strong>Your Recommended (yearly) Salary:</strong>{" "}
                {userGdpShare.shareInGDP.toString()}{" = "}
                {worldGdp ? `$${(userGdpShare.shareInGDP * worldGdp.worldGdp).toLocaleString()}` : "Calculating..."}</p>
              <p style={{ fontSize: '0.9rem', color: '#888' }}>
                This represents your calculated portion of the world economy based on your contributions
              </p>
            </div>
          ) : (
            <div>
              <p><span aria-hidden="true">⏳</span> <strong>Your Recommended (yearly) Salary:</strong> Not yet calculated</p>
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
          <h2>🚀 Start Your Evaluation</h2>
          {user.onboarded ? (
            <div style={{
              padding: '1rem',
              background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
              borderRadius: '8px',
              borderLeft: '4px solid #f59e0b',
              marginBottom: '1rem'
            }}>
              <p style={{ margin: 0, color: '#92400e', fontWeight: '600' }}>
                <span aria-hidden="true">🎉</span> <strong>You have already been onboarded!</strong>
              </p>
              <p style={{ margin: '0.5rem 0 0 0', color: '#92400e', fontSize: '0.9rem' }}>
                Your evaluation process has been completed. You can view your progress and results in the <a href="/logs" style={{ color: '#b45309', textDecoration: 'underline' }}>Logs</a> page.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ marginBottom: 0 }}>
                Start evaluation from the <a href="/connect" style={{ color: '#646cff' }}>Connect</a> page after linking your accounts.
              </p>
            </div>
          )}
        </div>
      )}
      <div style={{textAlign: 'left'}}>
        <h2>What is SciWard?</h2>
        <p>SciWard is an AI-powered funding platform for researchers and open-source developers.</p>
        <p>SciWard is:</p>
        <ul>
          <li>An AI-powered funding platform</li>
          <li>Focused on science and open-source software</li>
          <li>Uses transparent evaluation and audit logs</li>
        </ul>
        <h2>How SciWard Works</h2>
        <p>The app asks the AI, what portion of the global GDP a user is worth based on analyzing his/her Web accounts, and then gives him/her the proportional share of donated funds.</p>
        <h2>Who Can Apply</h2>
        <p>Everybody who has published any research or software can apply. Science degree is <em>not</em> required.</p>
        <h2>How Funding Decisions Are Made</h2>
        <p>Funding decisions are made by an AI, whose reasonings are transparently published in Audit Logs. AI is oversaw by voters to prevent scams such as prompt injections, banning a user.</p>
        <h2>About SciWard</h2>
        <p>SciWard supports open scientific funding models.</p>
      </div>
    </div>
  )
}
