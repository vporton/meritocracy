# Disconnected Account Cleanup

This document describes the disconnected account cleanup functionality that automatically removes inactive user accounts while preserving banned accounts and KYC data to prevent ban evasion.

## Overview

The disconnected account cleanup system helps maintain a clean database by removing user accounts that are no longer active, while ensuring that banned accounts and KYC data are preserved for security and moderation purposes.

## How It Works

### Definition of "Disconnected Account"

An account is considered "disconnected" if it meets ALL of the following criteria:

1. **No Active Sessions**: All user sessions have expired (no sessions with `expiresAt > current time`)
2. **Never Been Banned**: The user has never been banned (`bannedTill` is null - never had a ban)
3. **No KYC Data**: The user has no KYC verification data (`kycStatus` is null - never had KYC verification)
4. **Past Grace Period**: The account was created more than the specified grace period ago (default: 30 days)

**⚠️ SECURITY IMPORTANT**: 
- Accounts that have **ever** been banned are **never** deleted, even if the ban has expired. This prevents ban evasion by disconnecting OAuth accounts and creating new ones to bypass bans.
- Accounts with **KYC data** are **never** deleted, as deleting KYC would allow ban evasion through identity verification bypass.

### What Gets Deleted

When a disconnected account is deleted, the following data is removed due to cascade deletion:

- User record
- All associated sessions
- Email verification tokens
- Gas token distributions
- OpenAI logs
- Any other related data

### What Gets Preserved

- **Ever-Banned Accounts**: Users who have ever been banned (`bannedTill` is not null) are never deleted, even if the ban has expired
- **Currently Banned Accounts**: Users with `bannedTill > current time` are never deleted
- **KYC Accounts**: Users with KYC data (`kycStatus` is not null) are never deleted to prevent ban evasion
- **Active Users**: Users with active sessions are never deleted
- **Recent Accounts**: Accounts created within the grace period are never deleted

## Components

### 1. DisconnectedAccountCleanupService

**Location**: `src/services/DisconnectedAccountCleanupService.ts`

**Key Methods**:
- `cleanupDisconnectedAccounts(gracePeriodDays, dryRun)`: Main cleanup method
- `getDisconnectedAccountStats(gracePeriodDays)`: Get statistics without deleting

**Parameters**:
- `gracePeriodDays`: Number of days to wait before considering an account disconnected (default: 30)
- `dryRun`: If true, only count accounts that would be deleted without actually deleting them

### 2. CronService Integration

**Location**: `src/services/CronService.ts`

**Schedule**: Runs on the 1st of every month at 4:00 AM UTC
**Cron Expression**: `0 4 1 * *`

**Methods**:
- `startMonthlyCleanupCron()`: Start the scheduled cleanup
- `stopMonthlyCleanupCron()`: Stop the scheduled cleanup
- `runMonthlyCleanup()`: Manually trigger cleanup

### 3. API Endpoints

**Location**: `src/routes/cleanup.ts`

**Endpoints**:

#### GET `/api/cleanup/stats`
Get statistics about disconnected accounts without deleting them.

**Query Parameters**:
- `gracePeriodDays` (optional): Grace period in days (default: 30, max: 365)

**Response**:
```json
{
  "success": true,
  "data": {
    "totalUsers": 1000,
    "usersWithActiveSessions": 800,
    "bannedUsers": 50,
    "kycUsers": 200,
    "disconnectedUsers": 100,
    "gracePeriodDays": 30,
    "summary": {
      "totalUsers": 1000,
      "activeUsers": 800,
      "bannedUsers": 50,
      "kycUsers": 200,
      "disconnectedUsers": 100,
      "percentageDisconnected": "10.00%"
    },
    "security": {
      "preservedBannedAccounts": 50,
      "preservedKycAccounts": 200,
      "note": "Banned and KYC accounts are never deleted to prevent ban evasion"
    }
  }
}
```

#### POST `/api/cleanup/dry-run`
Perform a dry run to see what would be deleted.

**Request Body**:
```json
{
  "gracePeriodDays": 30
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "deletedCount": 100,
    "preservedBannedCount": 50,
    "preservedKycCount": 200,
    "errors": [],
    "details": {
      "disconnectedAccounts": 100,
      "bannedAccounts": 50,
      "kycAccounts": 200,
      "accountsWithActiveSessions": 800
    },
    "gracePeriodDays": 30,
    "message": "This was a dry run - no accounts were actually deleted",
    "security": {
      "preservedBannedAccounts": 50,
      "preservedKycAccounts": 200,
      "note": "Banned and KYC accounts are never deleted to prevent ban evasion"
    }
  }
}
```

#### POST `/api/cleanup/execute`
Execute the actual cleanup process.

**Request Body**:
```json
{
  "gracePeriodDays": 30,
  "confirmDeletion": true
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "deletedCount": 100,
    "preservedBannedCount": 50,
    "preservedKycCount": 200,
    "errors": [],
    "details": {
      "disconnectedAccounts": 100,
      "bannedAccounts": 50,
      "kycAccounts": 200,
      "accountsWithActiveSessions": 800
    },
    "gracePeriodDays": 30,
    "message": "Cleanup completed. Disconnected accounts have been permanently deleted.",
    "security": {
      "preservedBannedAccounts": 50,
      "preservedKycAccounts": 200,
      "note": "Banned and KYC accounts were preserved to prevent ban evasion"
    }
  }
}
```

## Security Considerations

### Ban Evasion Prevention
**CRITICAL**: The system prevents ban evasion by never deleting accounts that have ever been banned, even if the ban has expired. This prevents users from:
1. Getting banned
2. Disconnecting all OAuth accounts
3. Waiting for ban to expire
4. Having their account deleted by cleanup
5. Creating a new account to bypass the ban

### KYC Data Protection
**CRITICAL**: The system prevents ban evasion through KYC bypass by never deleting accounts with KYC data. This prevents users from:
1. Getting banned
2. Having their account deleted (including KYC data)
3. Creating a new account and bypassing KYC verification
4. Using the same identity to bypass the ban

### Authentication Required
All API endpoints require authentication via the `requireAuth` middleware.

### Confirmation Required
The execute endpoint requires explicit confirmation (`confirmDeletion: true`) to prevent accidental deletions.

### Grace Period Limits
Grace period is limited to 1-365 days to prevent abuse.

### Batch Processing
Accounts are deleted in batches of 50 to avoid overwhelming the database.

## Usage Examples

### Check Current Statistics
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "http://localhost:3001/api/cleanup/stats?gracePeriodDays=30"
```

### Perform Dry Run
```bash
curl -X POST \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"gracePeriodDays": 30}' \
     "http://localhost:3001/api/cleanup/dry-run"
```

### Execute Cleanup
```bash
curl -X POST \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"gracePeriodDays": 30, "confirmDeletion": true}' \
     "http://localhost:3001/api/cleanup/execute"
```

## Monitoring

### Cron Job Status
Check the status of all cron jobs including the monthly cleanup:

```bash
curl "http://localhost:3001/api/cron/status"
```

### Logs
The cleanup process logs detailed information about:
- Number of accounts found in each category (active, banned, KYC, disconnected)
- Accounts being deleted (with details)
- Any errors that occur
- Final summary of the operation including security preservation counts

## Configuration

### Environment Variables
No additional environment variables are required. The cleanup uses the existing database connection.

### Grace Period
The default grace period is 30 days, but can be customized per operation.

### Schedule
The cleanup runs monthly on the 1st at 4:00 AM UTC. This can be modified in the CronService.

## Best Practices

1. **Always run a dry run first** before executing actual cleanup
2. **Monitor the logs** during cleanup operations
3. **Use appropriate grace periods** based on your user activity patterns
4. **Test in development** before deploying to production
5. **Keep backups** before running cleanup in production
6. **Never modify KYC data** outside of the normal verification process

## Troubleshooting

### Common Issues

1. **No accounts deleted**: Check if accounts have active sessions, are banned, or have KYC data
2. **Banned accounts deleted**: This should never happen - check the logic in the service
3. **KYC accounts deleted**: This should never happen - check the logic in the service
4. **Database errors**: Check database connectivity and permissions
5. **Authentication errors**: Ensure proper authentication tokens are used

### Debug Mode
Enable detailed logging by checking the console output during cleanup operations.

## Security Audit Checklist

- [ ] Banned accounts are never deleted (even if ban expired)
- [ ] KYC accounts are never deleted
- [ ] Active sessions prevent deletion
- [ ] Grace period is respected
- [ ] Authentication is required for all operations
- [ ] Confirmation is required for actual deletion
- [ ] Batch processing prevents database overload
- [ ] Comprehensive logging is in place
- [ ] Error handling prevents partial deletions
