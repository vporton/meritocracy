# Gas Token Distribution System

This document describes the weekly gas token distribution system that automatically distributes Ethereum gas tokens to onboarded users based on their GDP share.

## Overview

The system runs weekly (every Sunday at 3:00 AM UTC) and:
- Calculates each user's share based on their `shareInGDP` percentage
- Distributes gas tokens proportionally to their GDP contribution
- Defers distributions under $20 to a reserve fund
- Maintains a small gas reserve for transaction fees
- Tracks all distributions and reserves in the database

## Database Models

### GasTokenDistribution
Tracks individual distribution attempts:
- `userId`: Reference to the user
- `amount`: Amount in ETH (gas token)
- `amountUsd`: USD value at time of distribution
- `status`: PENDING, SENT, FAILED, DEFERRED
- `transactionHash`: Ethereum transaction hash (if sent)
- `errorMessage`: Error details (if failed)

### GasTokenReserve
Tracks accumulated reserve funds:
- `totalReserve`: Total accumulated reserve in ETH
- `lastDistribution`: Timestamp of last distribution run

## Configuration

### Minimum Distribution Threshold
- **$20 USD**: Distributions below this amount are deferred to reserve
- Configurable in `GasTokenDistributionService.MINIMUM_DISTRIBUTION_USD`

### Gas Reserve
- **0.01 ETH**: Kept in wallet for transaction fees
- Configurable in `GasTokenDistributionService.GAS_RESERVE_ETH`

### ETH Price
- Currently uses placeholder value ($2000)
- **TODO**: Implement real-time ETH price fetching from CoinGecko/CoinMarketCap

## API Endpoints

### GET /api/cron/status
Returns status of both cron jobs (bi-monthly evaluation and weekly gas distribution).

**Note**: All other endpoints have been removed for security reasons. The following endpoints were removed:
- `POST /api/cron/run-gas-distribution` - Manual triggering of financial transactions
- `GET /api/cron/gas-distribution-history` - Financial transaction history
- `GET /api/cron/gas-reserve-status` - Financial status information
- `GET /api/cron/eligible-users` - User personal data

These endpoints exposed sensitive financial data and allowed dangerous operations. The system is designed to run automatically without manual intervention.

## Service Classes

### GasTokenDistributionService
Main service handling distribution logic:
- `processWeeklyDistribution()`: Main distribution process
- `calculateDistributions()`: Calculate amounts based on GDP shares
- `getReserveStatus()`: Get current reserve information
- `getAllDistributionHistory()`: Get distribution history

### CronService
Updated to include weekly gas distribution:
- `startWeeklyGasDistributionCron()`: Start weekly cron job
- `runWeeklyGasDistribution()`: Manual trigger
- `getCronStatus()`: Status of both cron jobs

## Distribution Process

1. **Calculate Distributions**: For each onboarded user with `ethereumAddress` and `shareInGDP`:
   - Calculate their GDP share amount
   - Convert to ETH using current price
   - Determine if amount meets $20 minimum

2. **Process Each Distribution**:
   - **≥ $20**: Send ETH immediately, record as SENT
   - **< $20**: Add to reserve, record as DEFERRED
   - **Send Failed**: Add to reserve, record as FAILED

3. **Update Reserve**: Accumulate all deferred/failed amounts

4. **Log Results**: Comprehensive logging of all operations

## Requirements

- Users must have:
  - `onboarded: true`
  - `ethereumAddress` (not null)
  - `shareInGDP` (not null)
- World GDP data must be available in `Global` table
- Ethereum wallet must be configured with sufficient balance

## Security Considerations

- Private keys stored in `ethereum-keys.secret` file
- No public API endpoints for starting/stopping cron jobs
- All distributions logged with transaction hashes
- Failed transactions are tracked and retried in future runs

## Monitoring

- Check `/api/cron/status` for cron job status
- Server logs contain detailed operation information
- Monitor database directly for distribution history and reserve status
- Use admin tools or direct database access for detailed monitoring

**Note**: Direct API access to financial data has been removed for security. Use database queries or admin tools for detailed monitoring.

## Future Enhancements

1. **Real-time ETH Price**: Integrate with CoinGecko/CoinMarketCap API
2. **Retry Logic**: Automatically retry failed transactions
3. **Batch Transactions**: Optimize gas usage with batch sends
4. **Notifications**: Alert users of successful distributions
5. **Analytics**: Dashboard for distribution statistics
6. **Configurable Thresholds**: Admin interface for minimum amounts

## Troubleshooting

### Common Issues

1. **No Eligible Users**: Ensure users have `onboarded: true`, `ethereumAddress`, and `shareInGDP`
2. **Insufficient Balance**: Check wallet balance and gas reserve
3. **GDP Data Missing**: Ensure `GlobalDataService` has fetched world GDP
4. **Transaction Failures**: Check Ethereum network status and gas prices

### Debug Commands

```bash
# Check cron status (only remaining public endpoint)
curl http://localhost:3001/api/cron/status

# For detailed monitoring, use database queries:
# Check distribution history
# SELECT * FROM gas_token_distributions ORDER BY distributionDate DESC;

# Check reserve status
# SELECT * FROM gas_token_reserves;

# Check eligible users
# SELECT id, name, ethereumAddress, shareInGDP FROM users 
# WHERE onboarded = true AND ethereumAddress IS NOT NULL AND shareInGDP IS NOT NULL;
```

**Note**: Most debug endpoints have been removed for security. Use database queries for detailed information.

## Implementation Notes

- Uses `ethers.js` for Ethereum transactions
- Integrates with existing `CronService` architecture
- Follows existing database patterns and naming conventions
- Maintains backward compatibility with existing features
- Includes comprehensive error handling and logging
