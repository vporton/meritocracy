# Bi-Monthly Evaluation Cron Setup

This document describes the bi-monthly cron functionality that automatically creates evaluation flows for onboarded users who were updated more than a month ago.

## Overview

The cron service runs automatically on the 1st of every other month at 2:00 AM UTC, creating evaluation flows for users who:
- Are onboarded (`onboarded: true`)
- Were last updated more than 1 month ago

## API Endpoints

### Get Cron Status
```
GET /api/cron/status
```
Returns the current status of the cron job including whether it's running and the next scheduled run time.

### Get Eligible Users
```
GET /api/cron/eligible-users
```
Returns a list of users who are currently eligible for bi-monthly evaluation. Useful for debugging and monitoring.

## Security Note

The cron job management endpoints (start, stop, run) have been removed for security reasons. The cron service is designed to run automatically and should not be controlled via public API endpoints. Only read-only monitoring endpoints are available.

## Configuration

The cron job is automatically started when the server starts up. The schedule is:
- **Frequency**: Bi-monthly (1st of every other month)
- **Time**: 2:00 AM UTC
- **Cron Expression**: `0 2 1 */2 *`

## How It Works

1. **User Selection**: The system queries for users where:
   - `onboarded = true`
   - `updatedAt < (current_date - 1 month)`

2. **Evaluation Flow Creation**: For each eligible user, it creates an evaluation flow using the `UserEvaluationFlow.createEvaluationFlow()` method.

3. **Logging**: All operations are logged with detailed information about successes and failures.

4. **Error Handling**: If individual user processing fails, it logs the error and continues with the next user.

## Monitoring

The system provides comprehensive logging:
- ✅ Successful operations
- ❌ Failed operations with error details
- 📊 Summary statistics after each run
- 🕐 Cron job trigger notifications

## Graceful Shutdown

The cron service properly handles server shutdown signals (SIGINT, SIGTERM) to ensure clean termination.

## Testing

You can monitor the functionality using the available API endpoints:

1. **Check status**: `GET /api/cron/status`
2. **View eligible users**: `GET /api/cron/eligible-users`

For testing the actual cron functionality, you would need to:
- Modify the cron schedule temporarily for testing
- Use database queries to verify evaluation flows are created
- Check server logs for cron job execution

## Dependencies

- `node-cron`: For scheduling functionality
- `@types/node-cron`: TypeScript definitions
- `PrismaClient`: Database operations
- `UserEvaluationFlow`: Evaluation flow creation
