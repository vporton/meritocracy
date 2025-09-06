# Ethereum Integration

This document explains how to use the Ethereum integration in the socialism backend API.

## Setup

### 1. Install Dependencies

Ethers.js is already included in the project dependencies. If you need to install it manually:

```bash
npm install ethers
```

### 2. Configure Ethereum Keys

1. Create your Ethereum private key file:
   ```bash
   cp ethereum-keys.secret.example ethereum-keys.secret
   ```

2. Edit `ethereum-keys.secret` with your actual private key:
   ```
   ETHEREUM_PRIVATE_KEY=0xYOUR_ACTUAL_PRIVATE_KEY_HERE
   ETHEREUM_NETWORK=mainnet
   # ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
   ```

   **⚠️ SECURITY WARNING:** 
   - Never commit `ethereum-keys.secret` to version control
   - Generate a new private key for production use
   - The example key is for demonstration only

### 3. Generate a New Private Key (Recommended)

For production, generate a new private key:

```bash
# Using OpenSSL
openssl rand -hex 32

# Or using Node.js
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

## Usage

### Service Usage

```typescript
import { ethereumService } from './services/ethereum';

// Get wallet information
const address = ethereumService.getAddress();
const balance = await ethereumService.getBalance();

// Sign a message
const signature = await ethereumService.signMessage('Hello World');

// Verify a signature
const recoveredAddress = ethereumService.verifyMessage('Hello World', signature);

// Send a transaction
const tx = await ethereumService.sendTransaction('0x...', '0.1'); // Send 0.1 ETH

// Interact with contracts
const contract = ethereumService.getContract(contractAddress, contractABI);
```

### API Endpoints

The following REST API endpoints are available:

#### GET `/api/ethereum/wallet-info`
Get wallet address, balance, and network information.

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x742d35Cc6Db6b1c8...",
    "balance": "1.23 ETH",
    "network": "mainnet",
    "chainId": "1"
  }
}
```

#### POST `/api/ethereum/sign-message`
Sign a message with the wallet's private key.

**Request:**
```json
{
  "message": "Hello World"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Hello World",
    "signature": "0x1234567890abcdef...",
    "address": "0x742d35Cc6Db6b1c8..."
  }
}
```

#### POST `/api/ethereum/verify-signature`
Verify a message signature.

**Request:**
```json
{
  "message": "Hello World",
  "signature": "0x1234567890abcdef..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Hello World",
    "signature": "0x1234567890abcdef...",
    "recoveredAddress": "0x742d35Cc6Db6b1c8...",
    "signerAddress": "0x742d35Cc6Db6b1c8...",
    "isValid": true
  }
}
```

#### GET `/api/ethereum/network`
Get current network information and gas prices.

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "mainnet",
    "chainId": "1",
    "gasPrice": "20000000000",
    "maxFeePerGas": "30000000000",
    "maxPriorityFeePerGas": "2000000000"
  }
}
```

## Supported Networks

- `mainnet` - Ethereum Mainnet
- `goerli` - Goerli Testnet
- `sepolia` - Sepolia Testnet
- `polygon` - Polygon Mainnet
- `localhost` - Local development network (http://localhost:8545)

## Security Best Practices

1. **Never expose private keys**: Always keep private keys in secure files excluded from version control
2. **Use environment-specific keys**: Different keys for development, staging, and production
3. **Implement proper access controls**: Restrict API endpoints as needed
4. **Monitor transactions**: Log all blockchain interactions
5. **Use testnet for development**: Test with testnet tokens before mainnet deployment

## Error Handling

The service includes comprehensive error handling:

- Configuration file not found
- Invalid private key format
- Network connection issues
- Transaction failures
- Insufficient balance

## Example Usage

See `src/examples/ethereum-example.ts` for a complete example of how to use the Ethereum service.

To run the example:

```typescript
import { ethereumExample } from './examples/ethereum-example';
ethereumExample();
```
