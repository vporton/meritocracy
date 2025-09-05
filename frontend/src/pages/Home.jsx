import { useState, useEffect } from 'react'
import api from '../services/api'

function Home() {
  const [serverStatus, setServerStatus] = useState(null)
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return <div className="loading">Checking server status...</div>
  }

  return (
    <div>
      <h1>Welcome to Socialism App</h1>
      <div className="card">
        <h2>🚀 Node.js + React + Prisma Template</h2>
        <p>
          This is a full-stack application template featuring:
        </p>
        <ul style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto' }}>
          <li><strong>Backend:</strong> Node.js with Express</li>
          <li><strong>Database:</strong> Prisma ORM (supports MySQL, PostgreSQL, SQLite)</li>
          <li><strong>Frontend:</strong> React with Vite</li>
          <li><strong>API:</strong> RESTful endpoints for users and posts</li>
          <li><strong>Routing:</strong> React Router for navigation</li>
        </ul>
      </div>

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
            <p>💬 <strong>Message:</strong> {serverStatus?.message}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Quick Start</h3>
        <div style={{ textAlign: 'left' }}>
          <p><strong>1. Start the backend:</strong></p>
          <code>cd backend && npm install && npm run dev</code>
          
          <p><strong>2. Start the frontend:</strong></p>
          <code>cd frontend && npm install && npm run dev</code>
          
          <p><strong>3. Initialize the database:</strong></p>
          <code>cd backend && npx prisma db push && npm run db:seed</code>
        </div>
      </div>
    </div>
  )
}

export default Home
