/**
 * Example usage of Ethereum service
 * This file demonstrates how to use the Ethereum service with Ethers.js
 */

import { ethereumService } from '../services/ethereum.js';

async function ethereumExample() {
    try {
        console.log('=== Ethereum Service Example ===');
        
        // Get wallet information
        const address = ethereumService.getAddress();
        console.log('Wallet Address:', address);
        
        // Get network information
        const network = await ethereumService.getNetwork();
        console.log('Network:', network.name, 'Chain ID:', network.chainId);
        
        // Get balance
        const balance = await ethereumService.getBalance();
        console.log('Balance:', balance, 'ETH');
        
        // Sign a message
        const message = 'Hello from socialism app!';
        const signature = await ethereumService.signMessage(message);
        console.log('Message:', message);
        console.log('Signature:', signature);
        
        // Verify the signature
        const recoveredAddress = ethereumService.verifyMessage(message, signature);
        console.log('Recovered Address:', recoveredAddress);
        console.log('Signature Valid:', recoveredAddress.toLowerCase() === address.toLowerCase());
        
        // Example: Get current gas price
        const provider = ethereumService.getProvider();
        const gasPrice = await provider.getFeeData();
        console.log('Current Gas Price:', gasPrice.gasPrice?.toString(), 'wei');
        
    } catch (error) {
        console.error('Error in Ethereum example:', error);
    }
}

// Uncomment the line below to run the example
// ethereumExample();

export { ethereumExample };
