# Gas Token Balance Guide

This guide explains how to view gas token balances for all supported networks in the Socialism app.

## Overview

The Socialism app supports multiple Ethereum networks for gas token distribution. You can view balances across all enabled networks using the provided tools and API endpoints.

## Supported Networks

The system supports the following networks:

- **mainnet** - Ethereum Mainnet (Primary network)
- **polygon** - Polygon (MATIC) - Lower gas costs
- **arbitrum** - Arbitrum One - L2 scaling solution
- **optimism** - Optimism - L2 scaling solution  
- **base** - Base (Coinbase L2) - Coinbase's L2
- **sepolia** - Sepolia Testnet - For testing
- **localhost** - Local Development - For local development

## Quick Start

### 1. View Gas Balances

Use the provided script to view gas token balances:

```bash
# From the project root
node show-gas-balances.js

# Or specify a custom API URL
node show-gas-balances.js http://localhost:3001
```

### 2. API Endpoints

You can also use the REST API directly:

```bash
# Get status of all enabled networks
curl http://localhost:3001/api/multi-network-gas/status

# Get reserve status for all networks
curl http://localhost:3001/api/multi-network-gas/reserve-status

# Get detailed status for a specific network
curl http://localhost:3001/api/multi-network-gas/network/mainnet/status
```

## Configuration

### Environment Setup

To enable networks, configure your `.env` file in the `backend/` directory:

```env
# Enable networks
ETHEREUM_MAINNET_ENABLED=true
ETHEREUM_POLYGON_ENABLED=true
ETHEREUM_ARBITRUM_ENABLED=true
ETHEREUM_OPTIMISM_ENABLED=true
ETHEREUM_BASE_ENABLED=true
ETHEREUM_SEPOLIA_ENABLED=false
ETHEREUM_LOCALHOST_ENABLED=false

# Provide RPC URLs (replace YOUR_PROJECT_ID with your actual Infura/Alchemy project ID)
ETHEREUM_MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_POLYGON_RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_ARBITRUM_RPC_URL=https://arbitrum-mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_OPTIMISM_RPC_URL=https://optimism-mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_BASE_RPC_URL=https://base-mainnet.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
ETHEREUM_LOCALHOST_RPC_URL=http://localhost:8545

# Private key for the wallet (same address will be used across all networks)
ETHEREUM_PRIVATE_KEY=0x...
```

### RPC Provider Setup

You'll need RPC access to the networks you want to use. Popular providers include:

- **Infura**: https://infura.io/
- **Alchemy**: https://alchemy.com/
- **QuickNode**: https://quicknode.com/
- **Public RPCs**: Some networks offer public RPC endpoints

## Understanding the Output

When you run the gas balance script, you'll see information like:

```
📊 Multi-Network Gas Token Status
🌐 Total Networks: 3
✅ Enabled Networks: mainnet, polygon, arbitrum

🌐 MAINNET
   Chain ID: 1
   Address: 0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
   Balance: 1.234567 ETH
   Gas Price: 0.000000020 ETH
   Gas Reserve: 0.01 ETH
   Available for Distribution: 1.224567 ETH
   Total Reserve: 0.5 ETH
   Min Distribution USD: $20
   Last Distribution: 1/15/2024, 2:30:45 PM

🌐 POLYGON
   Chain ID: 137
   Address: 0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6
   Balance: 100.123456 ETH
   Gas Price: 0.000000030 ETH
   Gas Reserve: 0.1 ETH
   Available for Distribution: 100.023456 ETH
   Total Reserve: 2.5 ETH
   Min Distribution USD: $5
   Last Distribution: 1/15/2024, 2:30:45 PM

🏦 Reserve Status Summary:
   Total Reserve Across All Networks: 3.0 ETH
   Total Available for Distribution: 101.248023 ETH
```

### Key Metrics Explained

- **Balance**: Current ETH balance in the wallet for this network
- **Gas Reserve**: Amount of ETH kept as gas reserve (not distributed)
- **Available for Distribution**: Balance minus gas reserve plus existing reserves
- **Total Reserve**: Accumulated small distributions that haven't been sent yet
- **Min Distribution USD**: Minimum USD value required to send a distribution
- **Last Distribution**: When the last distribution was processed

## Troubleshooting

### No Networks Enabled

If you see "No networks are currently enabled":

1. Check your `.env` file exists in the `backend/` directory
2. Verify that `ETHEREUM_*_ENABLED=true` is set for desired networks
3. Ensure RPC URLs are properly configured

### Connection Issues

If you see "Connection issue: Unable to fetch network data":

1. Verify your RPC URLs are correct and accessible
2. Check that your Infura/Alchemy project is active
3. Ensure you have sufficient API credits/quota
4. Test the RPC URL directly: `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' YOUR_RPC_URL`

### Zero Balances

If balances show as 0:

1. Ensure the wallet has ETH on the respective networks
2. Check that the private key is correct
3. Verify the wallet address is the same across networks

## Advanced Usage

### Manual Distribution

To manually trigger a gas token distribution:

```bash
curl -X POST http://localhost:3001/api/multi-network-gas/run-distribution
```

### View Distribution History

```bash
# All distributions
curl http://localhost:3001/api/multi-network-gas/distribution-history

# By network
curl http://localhost:3001/api/multi-network-gas/network/mainnet/distribution-history

# By user
curl http://localhost:3001/api/multi-network-gas/user/123/distribution-history
```

### Network-Specific Information

```bash
# Get detailed info for a specific network
curl http://localhost:3001/api/multi-network-gas/network/polygon/status
```

## Security Notes

- Never commit your `.env` file to version control
- Use environment-specific private keys
- Consider using hardware wallets for production
- Regularly rotate API keys and private keys
- Monitor your wallet balances and transaction history

## Support

For issues or questions:

1. Check the logs in `backend/server.log`
2. Run the test script: `node backend/test-multi-network.js`
3. Verify your configuration against the examples in `backend/env.example`
4. Check the API documentation in the source code
