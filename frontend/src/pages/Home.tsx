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
  const [ethereumStatus, setEthereumStatus] = useState<{network: string, balance: bigint, currency: string, address?: string} | undefined>()
  const [loading, setLoading] = useState(true)
  const [copySuccess, setCopySuccess] = useState(false)

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
