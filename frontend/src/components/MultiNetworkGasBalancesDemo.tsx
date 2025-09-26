import { useState } from 'react'

// Demo component showing what MultiNetworkGasBalances would look like with sample data
function MultiNetworkGasBalancesDemo() {
  const [showDemo, setShowDemo] = useState(false)

  if (!showDemo) {
    return (
      <div className="card">
        <h3>🌐 Multi-Network Gas Balances</h3>
        <div style={{
          padding: '1rem',
          background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
          borderRadius: '8px',
          borderLeft: '4px solid #0ea5e9',
          marginBottom: '1rem'
        }}>
          <p style={{ margin: 0, color: '#0c4a6e', fontWeight: '600' }}>
            📊 <strong>Network Summary</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#0c4a6e', fontSize: '0.9rem' }}>
            4 networks enabled: mainnet, polygon, arbitrum, optimism
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#0c4a6e', fontSize: '0.9rem' }}>
            Total Available: 109.483824 ETH | Total Reserve: 4.100000 ETH
          </p>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {/* Mainnet */}
          <div style={{
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #333',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: '#646cff' }}>
                🌐 MAINNET
              </h4>
              <span style={{
                padding: '0.2rem 0.6rem',
                background: '#4caf50',
                color: 'white',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: '500'
              }}>
                Chain 1
              </span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Balance:</strong> 1.234567 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Gas Price:</strong> 0.000000020 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Address:</strong> 
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
                  </span>
                </p>
              </div>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Available:</strong> 1.224567 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Reserve:</strong> 0.500000 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Min Distribution:</strong> $20
                </p>
              </div>
            </div>
            
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
              Last Distribution: 15/01/2024, 16:30:45
            </p>
          </div>

          {/* Polygon */}
          <div style={{
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #333',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: '#646cff' }}>
                🌐 POLYGON
              </h4>
              <span style={{
                padding: '0.2rem 0.6rem',
                background: '#4caf50',
                color: 'white',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: '500'
              }}>
                Chain 137
              </span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Balance:</strong> 100.123456 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Gas Price:</strong> 0.000000030 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Address:</strong> 
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
                  </span>
                </p>
              </div>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Available:</strong> 100.023456 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Reserve:</strong> 2.500000 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Min Distribution:</strong> $5
                </p>
              </div>
            </div>
            
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
              Last Distribution: 15/01/2024, 16:30:45
            </p>
          </div>

          {/* Arbitrum */}
          <div style={{
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #333',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: '#646cff' }}>
                🌐 ARBITRUM
              </h4>
              <span style={{
                padding: '0.2rem 0.6rem',
                background: '#4caf50',
                color: 'white',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: '500'
              }}>
                Chain 42161
              </span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Balance:</strong> 5.789012 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Gas Price:</strong> 0.000000015 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Address:</strong> 
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
                  </span>
                </p>
              </div>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Available:</strong> 5.784012 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Reserve:</strong> 0.800000 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Min Distribution:</strong> $10
                </p>
              </div>
            </div>
            
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
              Last Distribution: 15/01/2024, 16:30:45
            </p>
          </div>

          {/* Optimism */}
          <div style={{
            padding: '1rem',
            background: '#1a1a1a',
            borderRadius: '8px',
            border: '1px solid #333',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: '#646cff' }}>
                🌐 OPTIMISM
              </h4>
              <span style={{
                padding: '0.2rem 0.6rem',
                background: '#4caf50',
                color: 'white',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: '500'
              }}>
                Chain 10
              </span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Balance:</strong> 2.456789 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Gas Price:</strong> 0.000000018 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Address:</strong> 
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
                  </span>
                </p>
              </div>
              <div>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Available:</strong> 2.451789 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Reserve:</strong> 0.300000 ETH
                </p>
                <p style={{ margin: '0.25rem 0', color: '#888' }}>
                  <strong>Min Distribution:</strong> $10
                </p>
              </div>
            </div>
            
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#666' }}>
              Last Distribution: 15/01/2024, 16:30:45
            </p>
          </div>
        </div>

        <div style={{
          padding: '1rem',
          background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
          borderRadius: '8px',
          borderLeft: '4px solid #0ea5e9',
          marginTop: '1rem'
        }}>
          <p style={{ margin: 0, color: '#0c4a6e', fontWeight: '600' }}>
            💡 <strong>This is a demo</strong>
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#0c4a6e', fontSize: '0.9rem' }}>
            To see real data, configure your backend with network settings and start the server.
          </p>
        </div>
      </div>
    )
  }

  return null
}

export default MultiNetworkGasBalancesDemo
