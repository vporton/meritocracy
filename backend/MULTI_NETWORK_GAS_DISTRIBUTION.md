# Multi-Network Gas Token Distribution System

This document describes the enhanced gas token distribution system that supports multiple Ethereum-compatible networks with async fiber processing.

## Overview

The multi-network gas token distribution system extends the original single-network system to support:
- **Multiple Networks**: Ethereum Mainnet, Polygon, Arbitrum, Optimism, Base, Sepolia, and localhost
- **Async Fibers**: Parallel processing of distributions across networks
- **Unified Address**: One EVM address per user across all networks
- **Network-Specific Configuration**: Different gas reserves and minimum distribution thresholds per network
- **Comprehensive Monitoring**: Per-network status, reserves, and distribution history

## Architecture

### Core Components

1. **MultiNetworkEthereumService**: Manages connections to multiple networks
2. **MultiNetworkGasTokenDistributionService**: Handles distribution logic across networks
3. **Async Fibers**: Parallel processing of distributions per network
4. **Enhanced Database Schema**: Network-specific tracking

### Network Support

| Network | Chain ID | Gas Reserve | Min Distribution | Notes |
|---------|----------|-------------|------------------|-------|
| Mainnet | 1 | 0.01 ETH | $20 | Primary network |
| Polygon | 137 | 0.1 ETH | $5 | Lower gas costs, higher reserve |
| Arbitrum | 42161 | 0.005 ETH | $10 | L2 scaling solution |
| Optimism | 10 | 0.005 ETH | $10 | L2 scaling solution |
| Base | 8453 | 0.005 ETH | $10 | Coinbase L2 |
| Sepolia | 11155111 | 0.01 ETH | $0.1 | Testnet |
| Localhost | 1337 | 0.01 ETH | $0.1 | Development |

## Database Schema Changes

### GasTokenDistribution Model
```prisma
model GasTokenDistribution {
  id               Int      @id @default(autoincrement())
  userId           Int
  network          String   // Network identifier
  amount           Decimal
  amountUsd        Decimal
  distributionDate DateTime @default(now())
  status           String   @default("PENDING")
  transactionHash  String?
  errorMessage     String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, network, distributionDate]) // Prevent duplicates
  @@map("gas_token_distributions")
}
```

### GasTokenReserve Model
```prisma
model GasTokenReserve {
  id               Int      @id @default(autoincrement())
  network          String   // Network identifier
  totalReserve     Decimal  @default(0)
  lastDistribution DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([network]) // One reserve per network
  @@map("gas_token_reserves")
}
```

## Configuration

### Environment Variables

```env
# Multi-Network Ethereum Configuration
# Each network can be enabled/disabled independently
# Private key is shared across all networks (same address on all networks)

# Mainnet Configuration
ETHEREUM_MAINNET_ENABLED=true
ETHEREUM_MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID

# Polygon Configuration
ETHEREUM_POLYGON_ENABLED=false
ETHEREUM_POLYGON_RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID

# Arbitrum Configuration
ETHEREUM_ARBITRUM_ENABLED=false
ETHEREUM_ARBITRUM_RPC_URL=https://arbitrum-mainnet.infura.io/v3/YOUR_PROJECT_ID

# Optimism Configuration
ETHEREUM_OPTIMISM_ENABLED=false
ETHEREUM_OPTIMISM_RPC_URL=https://optimism-mainnet.infura.io/v3/YOUR_PROJECT_ID

# Base Configuration
ETHEREUM_BASE_ENABLED=false
ETHEREUM_BASE_RPC_URL=https://base-mainnet.infura.io/v3/YOUR_PROJECT_ID

# Sepolia Testnet Configuration
ETHEREUM_SEPOLIA_ENABLED=false
ETHEREUM_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID

# Localhost Development Configuration
ETHEREUM_LOCALHOST_ENABLED=false
ETHEREUM_LOCALHOST_RPC_URL=http://localhost:8545
```

## API Endpoints

### Multi-Network Status
- `GET /api/multi-network-gas/status` - Get status of all enabled networks
- `GET /api/multi-network-gas/reserve-status` - Get reserve status for all networks
- `GET /api/multi-network-gas/network/:networkName/status` - Get detailed status for a specific network

### Distribution History
- `GET /api/multi-network-gas/distribution-history` - Get distribution history across all networks
- `GET /api/multi-network-gas/network/:networkName/distribution-history` - Get distribution history for a specific network
- `GET /api/multi-network-gas/user/:userId/distribution-history` - Get distribution history for a specific user

### Manual Operations
- `POST /api/multi-network-gas/run-distribution` - Manually trigger multi-network distribution

## Async Fiber Processing

The system uses async fibers to process distributions in parallel across networks:

```typescript
// Create async fibers for each network
const networkPromises = Array.from(networkDistributions.entries()).map(
  async ([networkName, distributions]) => {
    try {
      const networkResult = await this.processNetworkDistribution(networkName, distributions);
      result.networkResults.set(networkName, networkResult);
      result.totalDistributed += networkResult.distributed;
      result.totalReserved += networkResult.reserved;
    } catch (error) {
      // Handle network-specific errors
    }
  }
);

// Wait for all network distributions to complete
await Promise.all(networkPromises);
```

## Distribution Process

### 1. Network Initialization
- Load enabled networks from environment variables
- Initialize viem clients for each network
- Verify network connectivity and balances

### 2. Distribution Calculation
- Calculate user distributions based on GDP share
- Apply network-specific minimum thresholds
- Check available balances per network

### 3. Async Fiber Processing
- Create parallel processing tasks for each network
- Process distributions independently
- Handle network-specific errors gracefully

### 4. Result Aggregation
- Collect results from all networks
- Update reserves per network
- Log comprehensive results

## Network-Specific Features

### Gas Reserve Management
Each network maintains its own gas reserve to ensure sufficient funds for transaction fees:
- **Mainnet**: 0.01 ETH (high gas costs)
- **Polygon**: 0.1 ETH (lower gas costs, higher reserve for volume)
- **L2 Networks**: 0.005 ETH (optimized for lower costs)

### Minimum Distribution Thresholds
Different networks have different minimum distribution amounts:
- **Mainnet**: $20 (high-value transactions)
- **L2 Networks**: $10 (lower costs enable smaller distributions)
- **Polygon**: $5 (very low costs)
- **Testnets**: $0.1 (for testing)

### Error Handling
- Network-specific error tracking
- Graceful degradation if a network fails
- Retry logic for failed transactions
- Comprehensive error logging

## Monitoring and Observability

### Network Status Monitoring
```typescript
const networkStatus = await multiNetworkGasTokenDistributionService.getNetworkStatus();
// Returns detailed status for each network including:
// - Balance and gas price
// - Reserve status
// - Last distribution time
// - Available funds for distribution
```

### Distribution History
- Per-network distribution tracking
- User-specific history across all networks
- Transaction hash tracking
- Error message logging

### Reserve Management
- Network-specific reserve tracking
- Automatic reserve updates
- Reserve utilization monitoring

## Security Considerations

### Private Key Management
- Single private key used across all networks
- Same address on all networks (deterministic)
- Secure key storage in `ethereum-keys.secret`
- Environment-specific key management

### Network Isolation
- Independent error handling per network
- Network-specific configuration
- Isolated reserve management
- Graceful degradation

### Transaction Security
- Comprehensive transaction logging
- Hash verification
- Error tracking and reporting
- Audit trail maintenance

## Performance Optimizations

### Parallel Processing
- Async fibers for network processing
- Concurrent transaction execution
- Non-blocking error handling
- Efficient resource utilization

### Network Optimization
- Connection pooling per network
- Efficient RPC usage
- Gas price optimization
- Batch processing capabilities

## Migration from Single Network

### Backward Compatibility
- Original `GasTokenDistributionService` remains available
- Legacy API endpoints continue to work
- Gradual migration path
- Configuration flexibility

### Data Migration
- Existing distributions remain valid
- New network field added to schema
- Automatic migration during deployment
- No data loss

## Troubleshooting

### Common Issues

1. **Network Connection Failures**
   - Check RPC URL configuration
   - Verify network connectivity
   - Monitor RPC rate limits

2. **Insufficient Balance**
   - Check network-specific balances
   - Verify gas reserve settings
   - Monitor reserve accumulation

3. **Transaction Failures**
   - Check gas price settings
   - Verify network congestion
   - Monitor transaction status

### Debug Commands

```bash
# Check network status
curl http://localhost:3001/api/multi-network-gas/status

# Check reserve status
curl http://localhost:3001/api/multi-network-gas/reserve-status

# Check specific network
curl http://localhost:3001/api/multi-network-gas/network/mainnet/status

# Manual distribution trigger
curl -X POST http://localhost:3001/api/multi-network-gas/run-distribution
```

## Future Enhancements

### Planned Features
1. **Dynamic Network Configuration**: Runtime network enable/disable
2. **Gas Price Optimization**: Dynamic gas price adjustment
3. **Batch Transactions**: Optimize gas usage with batch sends
4. **Network Health Monitoring**: Automated network health checks
5. **Cross-Chain Bridges**: Support for cross-chain token transfers

### Performance Improvements
1. **Connection Pooling**: Optimize RPC connections
2. **Caching**: Cache network status and gas prices
3. **Rate Limiting**: Intelligent RPC rate limiting
4. **Retry Logic**: Exponential backoff for failed transactions

## Testing

### Testnet Configuration
For testing, enable Sepolia testnet:
```env
ETHEREUM_SEPOLIA_ENABLED=true
ETHEREUM_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
```

### Local Development
For local development, enable localhost:
```env
ETHEREUM_LOCALHOST_ENABLED=true
ETHEREUM_LOCALHOST_RPC_URL=http://localhost:8545
```

### Production Deployment
1. Configure production RPC URLs
2. Enable only necessary networks
3. Set appropriate gas reserves
4. Monitor network performance
5. Implement proper error alerting

## Conclusion

The multi-network gas token distribution system provides a robust, scalable solution for distributing gas tokens across multiple Ethereum-compatible networks. With async fiber processing, network-specific configuration, and comprehensive monitoring, it ensures efficient and reliable token distribution while maintaining security and performance standards.
