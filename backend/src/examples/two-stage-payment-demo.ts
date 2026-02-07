/**
 * Example script demonstrating the two-stage payment system
 * 
 * This script shows how to:
 * 1. Prepare transactions (Stage 1) - Calculate hashes and store in DB
 * 2. Execute transactions (Stage 2) - Read from DB and execute on blockchain
 */

import { multiNetworkGasTokenDistributionService } from '../services/MultiNetworkGasTokenDistributionService.js';
import { pendingTransactionService } from '../services/PendingTransactionService.js';

async function runTwoStagePaymentDemo() {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  TWO-STAGE PAYMENT SYSTEM DEMO');
    console.log('══════════════════════════════════════════════════════════════\n');

    // ============================================================================
    // STAGE 1: Prepare Transactions
    // ============================================================================
    console.log('📝 STAGE 1: Preparing transactions...\n');

    const prepared = await multiNetworkGasTokenDistributionService
        .processMultiNetworkDistributionTwoStage();

    console.log('\n📊 Stage 1 Results:');
    console.log(`  🌐 Networks: ${prepared.networkResults.size}`);
    console.log(`  ❌ Errors: ${prepared.errors.length}`);

    // Show statistics
    const statsAfterStage1 = await pendingTransactionService.getStatistics();
    console.log('\n📈 Transaction Statistics After Stage 1:');
    console.log(`  📝 Pending: ${statsAfterStage1.pending}`);
    console.log(`  ⚡ Executing: ${statsAfterStage1.executing}`);
    console.log(`  ✅ Completed: ${statsAfterStage1.completed}`);
    console.log(`  ❌ Failed: ${statsAfterStage1.failed}`);
    console.log(`  📊 Total: ${statsAfterStage1.total}`);

    // ============================================================================
    //  STAGE 2: Execute Pending Transactions
    // ============================================================================
    console.log('\n\n🚀 STAGE 2: Executing pending transactions...\n');

    const executed = await multiNetworkGasTokenDistributionService
        .executePendingTransactions(undefined, 100);

    console.log('\n📊 Stage 2 Results:');
    console.log(`  ✅ Executed: ${executed.executed}`);
    console.log(`  ❌ Failed: ${executed.failed}`);
    console.log(`  ⏭️  Skipped: ${executed.skipped}`);
    console.log(`  Success: ${executed.success ? '✅' : '❌'}`);

    if (executed.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        executed.errors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error}`);
        });
    }

    // Show final statistics
    const statsAfterStage2 = await pendingTransactionService.getStatistics();
    console.log('\n📈 Final Transaction Statistics:');
    console.log(`  📝 Pending: ${statsAfterStage2.pending}`);
    console.log(`  ⚡ Executing: ${statsAfterStage2.executing}`);
    console.log(`  ✅ Completed: ${statsAfterStage2.completed}`);
    console.log(`  ❌ Failed: ${statsAfterStage2.failed}`);
    console.log(`  📊 Total: ${statsAfterStage2.total}`);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  DEMO COMPLETE');
    console.log('══════════════════════════════════════════════════════════════\n');
}

// Run the demo
runTwoStagePaymentDemo()
    .then(() => {
        console.log('✅ Demo completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Demo failed:', error);
        process.exit(1);
    });
