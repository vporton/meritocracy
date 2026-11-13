import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useSearchParams } from 'react-router-dom'
import Canonical from '../components/Canonical'
import { getFrontendOrigin } from '../config/origins'
import { User, usersApi } from '../services/api'
import './UserAuditLogsDirectory.css'

function displayName(user: User) {
  const name = user.name?.trim()
  return name && !/^User \d+$/.test(name) ? name : `User ${user.id}`
}

export default function UserAuditLogsDirectory() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  const cursorParam = searchParams.get('cursor')
  const cursor = cursorParam && /^\d+$/.test(cursorParam) ? Number(cursorParam) : undefined
  const [nextCursor, setNextCursor] = useState<number | null>(null)

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const response = await usersApi.getAll(cursor)
        setUsers(response.data.items)
        setNextCursor(response.data.pagination.nextCursor)
      } catch (requestError) {
        console.error('Failed to load users for audit-log directory:', requestError)
        setError('Failed to load users. Please try again later.')
      } finally {
        setIsLoading(false)
      }
    }

    loadUsers()
  }, [cursor])

  return (
    <div className="user-audit-logs-directory">
      <Helmet>
        <title>User Audit Logs - SciWard</title>
        <meta name="description" content="Browse public AI research and recommended-salary audit logs for every SciWard user." />
      </Helmet>
      <Canonical baseUrl={getFrontendOrigin()} />

      <div className="container">
        <header className="page-header">
          <Link to="/" className="back-link">← Back to home</Link>
          <h1>User Audit Logs</h1>
          <p>Browse the public AI research and sources behind each user's recommended salary.</p>
        </header>

        {isLoading ? (
          <div className="directory-status loading">Loading users...</div>
        ) : error ? (
          <div className="directory-status error-message">{error}</div>
        ) : users.length === 0 ? (
          <div className="directory-status empty-state">No users are available yet.</div>
        ) : (
          <>
            <ul className="user-audit-list">
              {users.map((user) => (
                <li key={user.id} className="user-audit-list-item">
                  <div>
                    <h2>{displayName(user)}</h2>
                    <p>User #{user.id}</p>
                  </div>
                  <Link to={`/logs/${user.id}`} className="user-audit-log-link">
                    View audit log
                  </Link>
                </li>
              ))}
            </ul>
            {nextCursor && (
              <nav className="directory-pagination" aria-label="User audit log pages">
                <Link to={`/user-audit-logs?cursor=${nextCursor}`}>Next users →</Link>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}
