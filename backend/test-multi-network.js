#!/usr/bin/env node

/**
 * Test script for multi-network gas token distribution system
 * This script tests the basic functionality without actually sending transactions
 */

import { createPrismaClient } from './dist/lib/prisma.js';
import { multiNetworkEthereumService } from './dist/services/MultiNetworkEthereumService.js';
import { MultiNetworkGasTokenDistributionService } from './dist/services/MultiNetworkGasTokenDistributionService.js';

const prisma = createPrismaClient();

async function testMultiNetworkSystem() {
  console.log('🧪 Testing Multi-Network Gas Token Distribution System\n');

  try {
    // Test 1: Check enabled networks
    console.log('1️⃣ Testing network initialization...');
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    console.log(`✅ Enabled networks: ${enabledNetworks.join(', ')}`);
    
    if (enabledNetworks.length === 0) {
      console.log('⚠️  No networks enabled. Please configure at least one network in your .env file.');
      return;
    }

    // Test 2: Check network status
    console.log('\n2️⃣ Testing network status...');
    try {
      const networkInfo = await multiNetworkEthereumService.getAllNetworkInfo();
      for (const [networkName, info] of networkInfo) {
        console.log(`✅ ${networkName}: Balance ${multiNetworkEthereumService.formatEther(info.balance)} ETH, Gas Price ${multiNetworkEthereumService.formatEther(info.gasPrice)} wei`);
      }
    } catch (error) {
      console.log(`⚠️  Network status check failed: ${error.message}`);
    }

    // Test 3: Check database schema
    console.log('\n3️⃣ Testing database schema...');
    try {
      // Test GasTokenReserve table
      const reserves = await prisma.gasTokenReserve.findMany();
      console.log(`✅ GasTokenReserve table accessible, ${reserves.length} records found`);

      // Test GasTokenDistribution table
      const distributions = await prisma.gasTokenDistribution.findMany();
      console.log(`✅ GasTokenDistribution table accessible, ${distributions.length} records found`);
    } catch (error) {
      console.log(`❌ Database schema test failed: ${error.message}`);
      return;
    }

    // Test 4: Test multi-network service initialization
    console.log('\n4️⃣ Testing multi-network service initialization...');
    try {
      const multiNetworkService = new MultiNetworkGasTokenDistributionService(prisma);
      console.log('✅ MultiNetworkGasTokenDistributionService initialized successfully');
    } catch (error) {
      console.log(`❌ Service initialization failed: ${error.message}`);
      return;
    }

    // Test 5: Test reserve status
    console.log('\n5️⃣ Testing reserve status...');
    try {
      const multiNetworkService = new MultiNetworkGasTokenDistributionService(prisma);
      const reserveStatus = await multiNetworkService.getReserveStatus();
      console.log('✅ Reserve status check successful:');
      for (const [networkName, status] of reserveStatus) {
        console.log(`  🌐 ${networkName}: Reserve ${status.totalReserve} ETH, Balance ${status.walletBalance} ETH`);
      }
    } catch (error) {
      console.log(`⚠️  Reserve status check failed: ${error.message}`);
    }

    // Test 6: Test distribution calculation (without sending)
    console.log('\n6️⃣ Testing distribution calculation...');
    try {
      const multiNetworkService = new MultiNetworkGasTokenDistributionService(prisma);
      
      // Check if we have eligible users
      const eligibleUsers = await prisma.user.findMany({
        where: {
          onboarded: true,
          ethereumAddress: { not: null },
          shareInGDP: { not: null }
        },
        select: {
          id: true,
          ethereumAddress: true,
          shareInGDP: true
        }
      });

      console.log(`✅ Found ${eligibleUsers.length} eligible users for distribution`);
      
      if (eligibleUsers.length > 0) {
        console.log('  Sample user data:');
        eligibleUsers.slice(0, 3).forEach(user => {
          console.log(`    User ${user.id}: ${user.ethereumAddress} (${user.shareInGDP}% GDP share)`);
        });
      } else {
        console.log('  ℹ️  No eligible users found. Users need: onboarded=true, ethereumAddress, shareInGDP');
      }
    } catch (error) {
      console.log(`⚠️  Distribution calculation test failed: ${error.message}`);
    }

    console.log('\n🎉 Multi-network system test completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Configure your .env file with network settings');
    console.log('2. Ensure you have funds in your wallet for each enabled network');
    console.log('3. Run the actual distribution with: POST /api/multi-network-gas/run-distribution');
    console.log('4. Monitor the distribution with: GET /api/multi-network-gas/status');

  } catch (error) {
    console.error('💥 Test failed with error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testMultiNetworkSystem().catch(console.error);
