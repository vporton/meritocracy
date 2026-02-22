import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface TransactionData {
    userId: number;
    network: string;
    recipientAddress: string;
    amount: number;
    backlogAmount: number;
    tokenType: string;
    tokenSymbol: string;
    tokenDecimals: number;
    timestamp?: string; // Optional: for deterministic hashing across retries
}

/**
 * Service for managing pending transactions in a two-stage payment system
 * Stage 1: Calculate transaction hash and store in DB
 * Stage 2: Execute stored transactions
 */
export class PendingTransactionService {
    private prisma: PrismaClient;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Compute deterministic hash for transaction data
     * This ensures the same transaction data always produces the same hash
     */
    computeTransactionHash(data: TransactionData): string {
        // Create a normalized representation of the transaction
        const normalizedData = {
            userId: data.userId,
            network: data.network,
            recipientAddress: data.recipientAddress.toLowerCase(), // Normalize address
            amount: data.amount.toString(),
            backlogAmount: data.backlogAmount.toString(),
            tokenType: data.tokenType,
            tokenSymbol: data.tokenSymbol,
            tokenDecimals: data.tokenDecimals,
            timestamp: data.timestamp || new Date().toISOString()
        };

        const dataString = JSON.stringify(normalizedData, Object.keys(normalizedData).sort());
        return crypto.createHash('sha256').update(dataString).digest('hex');
    }

    /**
     * Stage 1: Store transaction data with computed hash
     * Returns the transaction hash, or null if already exists
     */
    async storeTransaction(data: TransactionData): Promise<string | null> {
        const hash = this.computeTransactionHash(data);

        try {
            // Check if transaction already exists
            const existing = await this.prisma.pendingTransaction.findUnique({
                where: { transactionHash: hash }
            });

            if (existing) {
                console.log(`⚠️  Transaction with hash ${hash} already exists with status: ${existing.status}`);

                // If it's in a terminal state (COMPLETED or permanently FAILED after many attempts), don't recreate
                if (existing.status === 'COMPLETED') {
                    return null;
                }

                // If it's FAILED but hasn't exceeded retry limit, we can return the hash for retry
                if (existing.status === 'FAILED' && existing.executionAttempts < 3) {
                    return hash;
                }

                // For PENDING or EXECUTING, return the hash
                if (existing.status === 'PENDING' || existing.status === 'EXECUTING') {
                    return hash;
                }

                return null;
            }

            // Store new pending transaction
            await this.prisma.pendingTransaction.create({
                data: {
                    transactionHash: hash,
                    userId: data.userId,
                    network: data.network,
                    recipientAddress: data.recipientAddress,
                    amount: data.amount,
                    backlogAmount: data.backlogAmount,
                    tokenType: data.tokenType,
                    tokenSymbol: data.tokenSymbol,
                    tokenDecimals: data.tokenDecimals,
                    status: 'PENDING',
                    transactionData: JSON.stringify(data)
                }
            });

            console.log(`✅ Stored pending transaction with hash: ${hash}`);
            return hash;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`❌ Failed to store transaction: ${message}`);
            throw error;
        }
    }

    /**
     * Get all pending transactions ready for execution
     * Excludes transactions currently being executed or already completed
     */
    async getPendingTransactions(networkFilter?: string) {
        const where: any = {
            status: { in: ['PENDING', 'FAILED'] },
            executionAttempts: { lt: 3 } // Max 3 retry attempts
        };

        if (networkFilter) {
            where.network = networkFilter;
        }

        return await this.prisma.pendingTransaction.findMany({
            where,
            orderBy: [
                { network: 'asc' },
                { id: 'asc' } // ensure order of NONCEs is correct
            ], // Fair and stable sort order
            include: { user: true }
        });
    }

    /**
     * Mark transaction as being executed (prevents concurrent execution)
     */
    async markAsExecuting(transactionHash: string): Promise<boolean> {
        try {
            const result = await this.prisma.pendingTransaction.updateMany({
                where: {
                    transactionHash,
                    status: { in: ['PENDING', 'FAILED'] } // Only update if not already executing/completed
                },
                data: {
                    status: 'EXECUTING',
                    lastExecutionAttempt: new Date(),
                    executionAttempts: { increment: 1 }
                }
            });

            return result.count > 0;
        } catch (error) {
            console.error(`Failed to mark transaction ${transactionHash} as executing:`, error);
            return false;
        }
    }

    /**
     * Mark transaction as completed with blockchain transaction hash
     */
    async markAsCompleted(
        transactionHash: string,
        executedTransactionHash: string
    ): Promise<void> {
        await this.prisma.pendingTransaction.update({
            where: { transactionHash },
            data: {
                status: 'COMPLETED',
                executedTransactionHash,
                errorMessage: null
            }
        });

        console.log(`✅ Transaction ${transactionHash} completed with tx: ${executedTransactionHash}`);
    }

    /**
     * Mark transaction as failed with error message
     */
    async markAsFailed(transactionHash: string, errorMessage: string): Promise<void> {
        const tx = await this.prisma.pendingTransaction.findUnique({
            where: { transactionHash }
        });

        if (!tx) {
            throw new Error(`Transaction ${transactionHash} not found`);
        }

        await this.prisma.pendingTransaction.update({
            where: { transactionHash },
            data: {
                status: 'FAILED',
                errorMessage
            }
        });

        console.log(`❌ Transaction ${transactionHash} marked as failed: ${errorMessage}`);
    }

    /**
     * Reset stuck transactions that have been in EXECUTING state for too long
     * This handles cases where execution was interrupted (e.g., process crash)
     */
    async resetStuckTransactions(timeoutMinutes: number = 15): Promise<number> {
        const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);

        const result = await this.prisma.pendingTransaction.updateMany({
            where: {
                status: 'EXECUTING',
                lastExecutionAttempt: { lt: cutoffTime }
            },
            data: {
                status: 'PENDING'
            }
        });

        if (result.count > 0) {
            console.log(`🔄 Reset ${result.count} stuck transactions`);
        }

        return result.count;
    }

    /**
     * Get transaction statistics
     */
    async getStatistics() {
        const [pending, executing, completed, failed, total] = await Promise.all([
            this.prisma.pendingTransaction.count({ where: { status: 'PENDING' } }),
            this.prisma.pendingTransaction.count({ where: { status: 'EXECUTING' } }),
            this.prisma.pendingTransaction.count({ where: { status: 'COMPLETED' } }),
            this.prisma.pendingTransaction.count({ where: { status: 'FAILED' } }),
            this.prisma.pendingTransaction.count()
        ]);

        return {
            pending,
            executing,
            completed,
            failed,
            total
        };
    }

    /**
     * Clean up old completed transactions (optional housekeeping)
     */
    async cleanupOldTransactions(daysOld: number = 30): Promise<number> {
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const result = await this.prisma.pendingTransaction.deleteMany({
            where: {
                status: 'COMPLETED',
                updatedAt: { lt: cutoffDate }
            }
        });

        if (result.count > 0) {
            console.log(`🧹 Cleaned up ${result.count} old completed transactions`);
        }

        return result.count;
    }
}

// Export singleton instance
export const pendingTransactionService = new PendingTransactionService(prisma);
export default PendingTransactionService;
