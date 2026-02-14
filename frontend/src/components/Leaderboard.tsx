import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api, { usersApi, LeaderboardEntry } from '../services/api'

interface LeaderboardProps {
  limit?: number;
  showTop?: number; // Number of top entries to show by default
}

// TODO@P3: duplicate code
interface WorldGdpData {
  worldGdp: number;
  formatted: string;
  currency: string;
  lastUpdated: string;
}

function Leaderboard({ limit = 100, showTop = 10 }: LeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [worldGdp, setWorldGdp] = useState<WorldGdpData | null>(null)

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
    const fetchLeaderboard = async () => {
      try {
        setLoading(true)
        const response = await usersApi.getLeaderboard(limit)
        if (response.data.success) {
          setLeaderboard(response.data.data.leaderboard)
        }
      } catch (err) {
        console.error('Failed to fetch leaderboard:', err)
        setError('Failed to load leaderboard')
      } finally {
        setLoading(false)
      }
    }

    fetchLeaderboard()
  }, [limit])

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return `#${rank}`
  }

  const getRankStyle = (rank: number) => {
    if (rank <= 3) {
      return {
        fontWeight: 'bold' as const,
        color: rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : '#cd7f32'
      }
    }
    return {}
  }

  const displayEntries = showAll ? leaderboard : leaderboard.slice(0, showTop)

  if (loading) {
    return (
      <div className="card">
        <h3>🏆 Internet contributors leaderboard</h3>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="loading">Loading leaderboard...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3>🏆 Internet contributors leaderboard</h3>
        <div className="error">
          ❌ {error}
        </div>
      </div>
    )
  }

  if (leaderboard.length === 0) {
    return (
      <div className="card">
        <h3>🏆 Internet contributors leaderboard</h3>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>📊 No GDP shares have been calculated yet</p>
          <p style={{ fontSize: '0.9rem', color: '#888' }}>
            The leaderboard is visible to everyone once GDP shares are available
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h3>🏆 Internet contributors leaderboard</h3>
      <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem' }}>
        Top contributors to the world economy ({leaderboard.length} total)
      </p>

      <div className="leaderboard-container">
        <div className="leaderboard-header">
          <div className="col-rank">Rank</div>
          <div className="col-name">Name</div>
          <div className="col-share">Recommended (yearly) Salary</div>
        </div>

        {displayEntries.map((entry) => (
          <div
            key={entry.userId}
            className="leaderboard-row"
          >
            <div className="col-rank" style={getRankStyle(entry.rank)}>
              {getRankIcon(entry.rank)}
            </div>
            <div className="col-name">
              <Link
                to={`/logs/${entry.userId}`}
                className="audit-link"
                style={{
                  marginRight: '0.5rem',
                  fontSize: '0.85em',
                  textDecoration: 'underline'
                }}
                aria-label={`Audit Logs for user ${entry.userId}`}
                title={`View Audit Logs for User #${entry.userId}`}
              >
                Audit Logs
              </Link>
              <span className="leaderboard-name" title={`User #${entry.userId}: ${entry.name}`}>{entry.name}</span>
            </div>
            <div className="col-share">
              <span className="share-percent">{entry.shareInGDP} of GDP</span>
              {worldGdp && (
                <span className="share-value">
                  {' = '}${(entry.shareInGDP * worldGdp.worldGdp).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {leaderboard.length > showTop && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: '#646cff',
              border: 'none',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            {showAll ? `Show Top ${showTop}` : `Show All ${leaderboard.length}`}
          </button>
        </div>
      )}
    </div>
  )
}

export default Leaderboard
