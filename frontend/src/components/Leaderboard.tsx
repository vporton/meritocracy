import { useState, useEffect } from 'react'
import { usersApi, LeaderboardEntry } from '../services/api'

interface LeaderboardProps {
  limit?: number;
  showTop?: number; // Number of top entries to show by default
}

function Leaderboard({ limit = 100, showTop = 10 }: LeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

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
        <h3>🏆 GDP Share Leaderboard</h3>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="loading">Loading leaderboard...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3>🏆 GDP Share Leaderboard</h3>
        <div className="error">
          ❌ {error}
        </div>
      </div>
    )
  }

  if (leaderboard.length === 0) {
    return (
      <div className="card">
        <h3>🏆 GDP Share Leaderboard</h3>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>📊 No GDP shares have been calculated yet</p>
          <p style={{ fontSize: '0.9rem', color: '#888' }}>
            Complete your profile and evaluation to see the leaderboard
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h3>🏆 GDP Share Leaderboard</h3>
      <p style={{ fontSize: '0.9rem', color: '#888', marginBottom: '1rem' }}>
        Top contributors to the world economy ({leaderboard.length} total)
      </p>
      
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'auto 1fr auto', 
          gap: '0.5rem',
          alignItems: 'center',
          padding: '0.5rem',
          backgroundColor: '#2a2a2a',
          borderRadius: '4px',
          marginBottom: '0.5rem',
          fontSize: '0.9rem',
          fontWeight: 'bold'
        }}>
          <div>Rank</div>
          <div>Name</div>
          <div style={{ textAlign: 'right' }}>GDP Share</div>
        </div>
        
        {displayEntries.map((entry) => (
          <div
            key={entry.userId}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: '0.5rem',
              alignItems: 'center',
              padding: '0.75rem',
              borderBottom: '1px solid #333',
              fontSize: '0.9rem'
            }}
          >
            <div style={getRankStyle(entry.rank)}>
              {getRankIcon(entry.rank)}
            </div>
            <div style={{ 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap' 
            }}>
              {entry.name}
            </div>
            <div style={{ 
              textAlign: 'right', 
              fontWeight: 'bold',
              color: '#4caf50'
            }}>
              {entry.formatted}
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
