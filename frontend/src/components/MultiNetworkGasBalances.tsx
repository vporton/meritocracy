import { useState, useEffect } from 'react'
import api from '../services/api'

interface NetworkInfo {
  name?: string;
  networkName?: string;
  adapterType?: string;
  chainId?: number;
  tokenSymbol?: string;
  nativeTokenSymbol?: string;
  tokenDecimals?: number;
  tokenType?: string;
  gasPrice?: string;
  balance?: string;
  address?: string;
  balanceFormatted?: string;
  gasPriceFormatted?: string;
  availableForDistribution?: number;
  totalReserve?: number;
  lastDistribution?: string;
  walletBalance?: number;
}

interface MultiNetworkStatus {
  enabledNetworks: string[];
  networks: Record<string, NetworkInfo>;
  totalNetworks: number;
}

function MultiNetworkGasBalances() {
  const [networkStatus, setNetworkStatus] = useState<MultiNetworkStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingNetworks, setLoadingNetworks] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMultiNetworkStatus = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1. Fetch network list quickly
        const listResponse = await api.get('/api/multi-network-gas/list')

        if (listResponse.data.success) {
          const listData = listResponse.data.data
          const initialNetworks: Record<string, NetworkInfo> = {}
          const initialLoading: Record<string, boolean> = {}

          if (listData.networkDetails) {
            listData.networkDetails.forEach((net: any) => {
              initialNetworks[net.networkId] = {
                name: net.networkName,
                adapterType: net.adapterType,
                networkName: net.networkName
              }
              initialLoading[net.networkId] = true
            })
          }

          const enabledNetworks = listData.enabledNetworks || []
          setNetworkStatus({
            enabledNetworks,
            networks: initialNetworks,
            totalNetworks: listData.totalNetworks || 0
          })
          setLoadingNetworks(initialLoading)
          setLoading(false)

          // 2. Fetch each network's status individually in parallel
          enabledNetworks.forEach(async (networkName: string) => {
            try {
              const response = await api.get(`/api/multi-network-gas/network/${networkName}/status`)
              if (response.data.success) {
                const data = response.data.data
                setNetworkStatus(prev => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    networks: {
                      ...prev.networks,
                      [networkName]: {
                        ...prev.networks[networkName],
                        ...data
                      }
                    }
                  }
                })
              }
            } catch (err) {
              console.error(`Failed to fetch status for network ${networkName}:`, err)
            } finally {
              setLoadingNetworks(prev => ({ ...prev, [networkName]: false }))
            }
          })
        }

      } catch (err) {
        console.error('Failed to fetch multi-network status:', err)
        if (!networkStatus) {
          setError(err instanceof Error ? err.message : 'Failed to fetch network status')
        }
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
            <li>solana-mainnet - Solana (SOL)</li>
            <li>bitcoin-mainnet - Bitcoin (BTC)</li>
            <li>polkadot-mainnet - Polkadot (DOT)</li>
            <li>cosmoshub-mainnet - Cosmos Hub (ATOM)</li>
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
          const networkInfo = networkStatus.networks[networkName] ?? {}
          const isNetworkLoading = loadingNetworks[networkName]
          const lastDistribution = networkInfo.lastDistribution

          const displayName =
            networkInfo.name ?? networkInfo.networkName ?? networkName
          const chainBadgeText = typeof networkInfo.chainId === 'number'
            ? `Chain ${networkInfo.chainId}`
            : networkInfo.adapterType
              ? `${networkInfo.adapterType} network`
              : 'Network'
          const tokenSymbol =
            networkInfo.tokenSymbol ??
            networkInfo.nativeTokenSymbol ??
            'N/A'
          const fallbackDecimals =
            networkInfo.tokenDecimals ??
            6
          const fallbackWalletBalance = networkInfo.walletBalance
          const balanceFormatted =
            networkInfo.balanceFormatted ??
            (typeof fallbackWalletBalance === 'number'
              ? fallbackWalletBalance.toLocaleString('en-US', {
                maximumFractionDigits: fallbackDecimals
              })
              : 'N/A')
          const gasPriceFormatted =
            networkInfo.gasPriceFormatted ??
            'N/A'
          const address = networkInfo.address ?? 'N/A'
          const balanceDisplay = balanceFormatted === 'N/A'
            ? (isNetworkLoading ? 'Loading...' : 'N/A')
            : `${balanceFormatted} ${tokenSymbol}`
          const gasPriceDisplay = gasPriceFormatted === 'N/A'
            ? (isNetworkLoading ? 'Loading...' : 'N/A')
            : `${gasPriceFormatted} ${tokenSymbol}`

          return (
            <div key={networkName} style={{
              padding: '1rem',
              background: '#1a1a1a',
              borderRadius: '8px',
              border: '1px solid #333',
              textAlign: 'left',
              opacity: isNetworkLoading ? 0.7 : 1,
              transition: 'opacity 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0, color: '#646cff' }}>
                  🌐 {displayName}
                </h4>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {isNetworkLoading && (
                    <span className="loading-spinner" style={{ fontSize: '0.8rem', color: '#888' }}>
                      ⏳
                    </span>
                  )}
                  {chainBadgeText && (
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      background: '#4caf50',
                      color: 'white',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      textTransform: 'uppercase'
                    }}>
                      {chainBadgeText}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', fontSize: '0.9rem' }}>
                <div>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Balance:</strong> {balanceDisplay}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Gas Price:</strong> {gasPriceDisplay}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: '#888' }}>
                    <strong>Address:</strong>{" "}
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                      {address}
                    </span>
                  </p>
                </div>
              </div>

              {lastDistribution && (
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
                  Last Distribution: {new Date(lastDistribution).toLocaleString()}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Connection Issues Warning */}
      {networkStatus.enabledNetworks.some(networkName => {
        const networkInfo = networkStatus.networks[networkName]
        if (!networkInfo) return true
        const balanceFormatted = networkInfo.balanceFormatted ?? 'N/A'
        const gasPriceFormatted = networkInfo.gasPriceFormatted ?? 'N/A'
        return balanceFormatted === 'N/A' || gasPriceFormatted === 'N/A'
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
