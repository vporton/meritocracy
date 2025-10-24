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

interface ReserveStatus {
  [networkName: string]: {
    totalReserve?: number;
    walletBalance?: number;
    availableForDistribution?: number;
    lastDistribution?: string;
    adapterType?: string;
    networkName?: string;
    tokenSymbol?: string;
    nativeTokenSymbol?: string;
    tokenDecimals?: number;
    address?: string;
    gasPrice?: string;
    gasPriceFormatted?: string;
    balance?: string;
    balanceFormatted?: string;
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
        const [statusResponse, reserveResponse] = await Promise.all([
          api.get('/api/multi-network-gas/status'),
          api.get('/api/multi-network-gas/reserve-status')
        ])

        if (!statusResponse.data.success) {
          throw new Error(statusResponse.data.error || 'Failed to fetch network status')
        }

        const statusData = statusResponse.data.data as MultiNetworkStatus
        const reserveData = reserveResponse.data.success ? (reserveResponse.data.data as ReserveStatus) : {}

        const combinedNetworkNames = Array.from(
          new Set([
            ...(statusData.enabledNetworks ?? []),
            ...Object.keys(statusData.networks ?? {}),
            ...Object.keys(reserveData ?? {})
          ])
        )

        const mergedNetworks: Record<string, NetworkInfo> = { ...statusData.networks }
        for (const name of combinedNetworkNames) {
          const base = statusData.networks?.[name] ?? {}
          const reserve = reserveData?.[name] ?? {}
          mergedNetworks[name] = {
            ...reserve,
            ...base
          }
        }

        setNetworkStatus({
          ...statusData,
          enabledNetworks: combinedNetworkNames,
          totalNetworks: combinedNetworkNames.length,
          networks: mergedNetworks
        })

        if (reserveResponse.data.success) {
          setReserveStatus(reserveData)
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
          const reserveInfo = reserveStatus?.[networkName]
          const lastDistribution = networkInfo.lastDistribution ?? reserveInfo?.lastDistribution

          const displayName =
            networkInfo.name ?? networkInfo.networkName ?? reserveInfo?.networkName ?? networkName
          const chainBadgeText = typeof networkInfo.chainId === 'number'
            ? `Chain ${networkInfo.chainId}`
            : networkInfo.adapterType
            ? `${networkInfo.adapterType} network`
            : reserveInfo?.adapterType
            ? `${reserveInfo.adapterType} network`
            : 'Network'
          const tokenSymbol =
            networkInfo.tokenSymbol ??
            networkInfo.nativeTokenSymbol ??
            reserveInfo?.tokenSymbol ??
            reserveInfo?.nativeTokenSymbol ??
            'N/A'
          const fallbackDecimals =
            reserveInfo?.tokenDecimals ??
            networkInfo.tokenDecimals ??
            networkInfo.nativeTokenDecimals ??
            reserveInfo?.nativeTokenDecimals ??
            6
          const fallbackWalletBalance = reserveInfo?.walletBalance ?? networkInfo.walletBalance
          const balanceFormatted =
            networkInfo.balanceFormatted ??
            reserveInfo?.balanceFormatted ??
            (typeof fallbackWalletBalance === 'number'
              ? fallbackWalletBalance.toLocaleString('en-US', {
                  maximumFractionDigits: fallbackDecimals
                })
              : 'N/A')
          const gasPriceFormatted =
            networkInfo.gasPriceFormatted ??
            reserveInfo?.gasPriceFormatted ??
            'N/A'
          const address = networkInfo.address ?? reserveInfo?.address ?? 'N/A'
          const balanceDisplay = balanceFormatted === 'N/A'
            ? 'N/A'
            : `${balanceFormatted} ${tokenSymbol}`
          const gasPriceDisplay = gasPriceFormatted === 'N/A'
            ? 'N/A'
            : `${gasPriceFormatted} ${tokenSymbol}`

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
                  🌐 {displayName}
                </h4>
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
