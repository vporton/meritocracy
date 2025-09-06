import { useState, useEffect } from 'react'
import api from '../services/api'
import { ethers } from 'ethers';

interface ServerStatus {
  status?: string;
  version?: string;
  message?: string;
  error?: string;
}

function Home() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [ethereumStatus, setEthereumStatus] = useState<{network: string, balance: bigint, currency: string} | undefined>()
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

  useEffect(() => {
    const checkEthereumStatus = async () => {
      try {
        const response = await api.get('/api/ethereum/wallet-info')
        setEthereumStatus(response.data.data)
      } catch (error) {
        // setEthereumStatus({ error: 'Failed to connect to server' })
      } finally {
        // setLoading(false) // TODO
      }
    }

    checkEthereumStatus()
  }, [])

  if (loading) {
    return <div className="loading">Checking server status...</div>
  }

  return (
    <div>
      <h1>Welcome to Socialism App <span style={{ color: 'red' }}>⚠️This is a test version</span></h1>
      <p>After you connect your accounts, this app asks AI to analyze your works and assigns you a weekly payment, if you are a scientist or free software developer.</p>
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
    </div>
  )
}

export default Home
