# Two-Stage Payment System

## Overview

This implementation splits every payment into two stages to ensure reliability and prevent duplicate or missed transactions:

1. **Stage 1: Calculate & Store** - Compute transaction hash and store transaction data in the database
2. **Stage 2: Execute** - Read stored transactions from DB and execute them on the blockchain

## Key Features

### Prevents Double Execution
- Each transaction gets a unique deterministic hash based on its content
- Database unique constraint on `transactionHash` prevents duplicates
- Status transitions (`PENDING` → `EXECUTING` → `COMPLETED`/`FAILED`) ensure atomic execution
- Concurrent execution protection through optimistic locking

### Ensures No Missed Transactions
- All transactions stored in database before execution
- Failed transactions can be retried (up to 3 attempts)
- Stuck transactions automatically reset after timeout
- FIFO execution order ensures fairness

## Database Schema

### PendingTransaction Model
```prisma
model PendingTransaction {
  id                      Int      @id @default(autoincrement())
  transactionHash         String   @unique  // Computed SHA-256 hash
  userId                  Int
  network                 String
  recipientAddress        String
  amount                  Decimal
  backlogAmount           Decimal  @default(0)
  tokenType               String
  tokenSymbol             String
  tokenDecimals           Int
  status                  String   @default("PENDING")  // PENDING, EXECUTING, COMPLETED, FAILED
  executionAttempts       Int      @default(0)
  lastExecutionAttempt    DateTime?
  executedTransactionHash String?  // Blockchain tx hash after execution
  errorMessage            String?
  transactionData         String   // JSON
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  user                    User     @relation(...)
}
```

## Usage

### Stage 1: Prepare Transactions

```typescript
// Use the two-stage distribution method
const result = await multiNetworkGasTokenDistributionService
  .processMultiNetworkDistributionTwoStage();

```

### Stage 2: Execute Pending Transactions

```typescript
// Execute all pending transactions
const execution = await multiNetworkGasTokenDistributionService
  .executePendingTransactions();

console.log(`Executed: ${execution.executed}`);
console.log(`Failed: ${execution.failed}`);
console.log(`Skipped: ${execution.skipped}`);
```

## Transaction Status Flow

```
┌──────────┐
│ PENDING  │ ← Initial state after Stage 1
└────┬─────┘
     │
     ├──→ Mark as EXECUTING (atomic lock)
     │
     ▼
┌────────────┐
│ EXECUTING  │ ← Prevents concurrent execution
└────┬───────┘
     │
     ├──→ Success
     │    └──→ COMPLETED
     │
     └──→ Failure
          ├──→ FAILED (< 3 attempts)
          └──→ PENDING (for retry)
```

## Safeguards

### 1. Unique Hash Constraint
```typescript
const hash = crypto.createHash('sha256')
  .update(JSON.stringify(normalizedData))
  .digest('hex');
```

### 2. Optimistic Locking
```typescript
await prisma.pendingTransaction.updateMany({
  where: {
    transactionHash,
    status: { in: ['PENDING', 'FAILED'] }
  },
  data: { status: 'EXECUTING' }
});
```

### 3. Stuck Transaction Recovery
```typescript
// Automatically resets transactions stuck in EXECUTING for > 15 minutes
await pendingTransactionService.resetStuckTransactions(timeoutMinutes);
```

### 4. Retry Limit
```typescript
// Max 3 execution attempts per transaction
where: {
  executionAttempts: { lt: 3 }
}
```

## API Reference

### PendingTransactionService

#### `storeTransaction(data: TransactionData): Promise<string | null>`
Store a new pending transaction with computed hash. Returns the hash or null if duplicate.

#### `getPendingTransactions(networkFilter?: string): Promise<PendingTransaction[]>`
Get all pending transactions ready for execution (status PENDING or FAILED with < 3 attempts).

#### `markAsExecuting(transactionHash: string): Promise<boolean>`
Atomically mark transaction as executing. Returns false if already executing/completed.

#### `markAsCompleted(transactionHash: string, executedTxHash: string): Promise<void>`
Mark transaction as successfully completed with blockchain transaction hash.

#### `markAsFailed(transactionHash: string, errorMessage: string): Promise<void>`
Mark transaction as failed with error message.

#### `resetStuckTransactions(timeoutMinutes: number): Promise<number>`
Reset transactions stuck in EXECUTING state. Returns count of reset transactions.

#### `getStatistics(): Promise<{pending, executing, completed, failed, total}>`
Get transaction count statistics.

#### `cleanupOldTransactions(daysOld: number): Promise<number>`
Delete old completed transactions for housekeeping.

### MultiNetworkGasTokenDistributionService

#### `processMultiNetworkDistributionTwoStage(): Promise<MultiNetworkDistributionResult>`
**Stage 1**: Calculate distributions and store as pending transactions.

#### `executePendingTransactions(networkFilter?: string, maxTransactions?: number): Promise<ExecutionResult>`
**Stage 2**: Execute stored pending transactions.

## Example: Complete Two-Stage Flow

```typescript
import { multiNetworkGasTokenDistributionService } from './services/MultiNetworkGasTokenDistributionService.js';

// Stage 1: Prepare all transactions
console.log('🔄 Stage 1: Preparing transactions...');
const prepared = await multiNetworkGasTokenDistributionService
  .processMultiNetworkDistributionTwoStage();

console.log(`📊 Networks: ${prepared.networkResults.size}`);

// Stage 2: Execute pending transactions
console.log('🚀 Stage 2: Executing transactions...');
const executed = await multiNetworkGasTokenDistributionService
  .executePendingTransactions(undefined, 100);

console.log(`✅ Executed: ${executed.executed}`);
console.log(`❌ Failed: ${executed.failed}`);
console.log(`⏭️  Skipped: ${executed.skipped}`);

// Check statistics
const stats = await pendingTransactionService.getStatistics();
console.log('📊 Statistics:', stats);
```

## Monitoring & Maintenance

### Check Pending Transactions
```typescript
const stats = await pendingTransactionService.getStatistics();
if (stats.pending > 100) {
  console.warn(`${stats.pending} transactions pending execution`);
}
```

### Reset Stuck Transactions (Cron Job)
```typescript
// Run every 15 minutes
const reset = await pendingTransactionService.resetStuckTransactions(15);
if (reset > 0) {
  console.log(`Reset ${reset} stuck transactions`);
}
```

### Cleanup Old Transactions (Cron Job)
```typescript
// Run daily
const cleaned = await pendingTransactionService.cleanupOldTransactions(30);
console.log(`Cleaned up ${cleaned} old transactions`);
```

## Migration from Old System

To migrate from the immediate execution system to the two-stage system:

1. Update database schema: `npx prisma migrate dev --name add_pending_transactions`
2. Replace `processMultiNetworkDistribution()` calls with the two-stage flow
3. Set up a cron job to execute pending transactions periodically
4. Set up monitoring for stuck/failed transactions

## Benefits

✅ **Reliability**: Transactions stored before execution  
✅ **Idempotency**: Unique hashes prevent duplicates  
✅ **Resumability**: Failed transactions can be retried  
✅ **Auditability**: Full transaction history in database  
✅ **Safety**: Optimistic locking prevents race conditions  
✅ **Observability**: Clear status tracking and statistics
