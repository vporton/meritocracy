import { useState, useEffect } from 'react'
import api from '../services/api'

interface NetworkInfo {
  name: string;
  chainId: number;
  gasPrice: string; // Changed from bigint to string
  balance: string; // Changed from bigint to string
  address: string;
  balanceFormatted: string;
  gasPriceFormatted: string;
  availableForDistribution: number;
  totalReserve: number;
  lastDistribution?: string;
}

interface MultiNetworkStatus {
  enabledNetworks: string[];
  networks: Record<string, NetworkInfo>;
  totalNetworks: number;
}

interface ReserveStatus {
  [networkName: string]: {
    totalReserve: number;
    walletBalance: number;
    availableForDistribution: number;
    lastDistribution?: string;
  };
}

function MultiNetworkGasBalances() {
  const [networkStatus, setNetworkStatus] = useState<MultiNetworkStatus | null>(null)
  const [reserveStatus, setReserveStatus] = useState<ReserveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMultiNetworkStatus = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch network status
        const statusResponse = await api.get('/api/multi-network-gas/status')
        if (statusResponse.data.success) {
          setNetworkStatus(statusResponse.data.data)
        } else {
          throw new Error(statusResponse.data.error || 'Failed to fetch network status')
        }

        // Fetch reserve status
        const reserveResponse = await api.get('/api/multi-network-gas/reserve-status')
        if (reserveResponse.data.success) {
          setReserveStatus(reserveResponse.data.data)
        }

      } catch (err) {
        console.error('Failed to fetch multi-network status:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch network status')
      } finally {
        setLoading(false)
      }
    }

    fetchMultiNetworkStatus()
  }, [])

  if (loading) {
    return (
      <div className="card">
        <h3>🌐 Multi-Network Gas Balances</h3>
        <div className="loading">Loading network status...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3>🌐 Multi-Network Gas Balances</h3>
        <div className="error">
          ❌ {error}
          <br />
          <small>Make sure the backend server is running and multi-network support is configured</small>
        </div>
      </div>
    )
  }

  if (!networkStatus || networkStatus.enabledNetworks.length === 0) {
    return (
      <div className="card">
        <h3>🌐 Multi-Network Gas Balances</h3>
        <div style={{
          padding: '1rem',
          background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          borderRadius: '8px',
          borderLeft: '4px solid #f59e0b',
          marginBottom: '1rem'
        }}>
          <p style={{ margin: 0, color: '#92400e', fontWeight: '600' }}>
            ⚠️ <strong>No Networks Enabled</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#92400e', fontSize: '0.9rem' }}>
            Please configure your environment to enable multi-network support.
          </p>
        </div>
        <div style={{ fontSize: '0.9rem', color: '#888' }}>
          <p><strong>Supported Networks:</strong></p>
          <ul style={{ textAlign: 'left', margin: '0.5rem 0' }}>
            <li>mainnet - Ethereum Mainnet</li>
            <li>polygon - Polygon (MATIC)</li>
            <li>arbitrum - Arbitrum One</li>
            <li>optimism - Optimism</li>
            <li>base - Base (Coinbase L2)</li>
            <li>sepolia - Sepolia Testnet</li>
            <li>localhost - Local Development</li>
          </ul>
        </div>
      </div>
    )
  }

  // Note: Totals removed as they don't make sense when summing across different networks
  // with different gas reserves and potentially negative available amounts

  return (
    <div className="card">
      <h3>🌐 Multi-Network Gas Balances</h3>
      
      {/* Summary */}
      <div style={{
        padding: '1rem',
        background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
        borderRadius: '8px',
        borderLeft: '4px solid #0ea5e9',
        marginBottom: '1.5rem'
      }}>
        <p style={{ margin: 0, color: '#0c4a6e', fontWeight: '600' }}>
          📊 <strong>Network Summary</strong>
        </p>
        <p style={{ margin: '0.5rem 0 0 0', color: '#0c4a6e', fontSize: '0.9rem' }}>
          {networkStatus.totalNetworks} networks enabled: {networkStatus.enabledNetworks.join(', ')}
        </p>
      </div>

      {/* Network Details */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {networkStatus.enabledNetworks.map((networkName) => {
          const networkInfo = networkStatus.networks[networkName]
          const reserveInfo = reserveStatus?.[networkName]
          
          if (!networkInfo) {
            return (
              <div key={networkName} style={{
                padding: '1rem',
                background: '#2a1a1a',
                borderRadius: '8px',
                border: '1px solid #dc2626'
              }}>
                <p style={{ margin: 0, color: '#ff6b6b' }}>
                  ❌ {networkName}: Connection failed
                </p>
              </div>
            )
          }

          return (
            <div key={networkName} style={{
              padding: '1rem',
              background: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #333',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, color: '#646cff' }}>
                  🌐 {networkName.toUpperCase()}
                </h4>
                <span style={{
                  padding: '0.2rem 0.6rem',
                  background: '#4caf50',
                  color: 'white',
                  borderRadius: '12px',
                  fontSize: '0.8rem',
                  fontWeight: '500'
                }}>
                  Chain {networkInfo.chainId}
                </span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
                <div>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Balance:</strong> {networkInfo.balanceFormatted} ETH
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Gas Price:</strong> {networkInfo.gasPriceFormatted} ETH
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Address:</strong> 
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                      {networkInfo.address}
                    </span>
                  </p>
                </div>
                <div>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Available:</strong> {reserveInfo?.availableForDistribution?.toFixed(6) || 'N/A'} ETH
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Reserve:</strong> {reserveInfo?.totalReserve?.toFixed(6) || '0'} ETH
                  </p>
                </div>
              </div>
              
              {networkInfo.lastDistribution && (
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
                  Last Distribution: {new Date(networkInfo.lastDistribution).toLocaleString()}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Connection Issues Warning */}
      {networkStatus.enabledNetworks.some(networkName => {
        const networkInfo = networkStatus.networks[networkName]
        return !networkInfo || networkInfo.balanceFormatted === 'N/A' || networkInfo.gasPriceFormatted === 'N/A'
      }) && (
        <div style={{
          padding: '1rem',
          background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
          borderRadius: '8px',
          borderLeft: '4px solid #ef4444',
          marginTop: '1rem'
        }}>
          <p style={{ margin: 0, color: '#dc2626', fontWeight: '600' }}>
            ⚠️ <strong>Connection Issues Detected</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#dc2626', fontSize: '0.9rem' }}>
            Some networks are showing connection issues. Check your RPC URL configuration and network connectivity.
          </p>
        </div>
      )}
    </div>
  )
}

export default MultiNetworkGasBalances
