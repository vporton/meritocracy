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
        console.log('Network:', network.name, 'Chain ID:', network.id);
        
        // Get balance
        const balance = await ethereumService.getBalance();
        console.log('Balance:', balance, 'ETH');
        
        // Sign a message
        const message = 'Hello from socialism app!';
        const signature = await ethereumService.signMessage(message);
        console.log('Message:', message);
        console.log('Signature:', signature);
        
        // Verify the signature
        const isValid = await ethereumService.verifyMessage(message, signature);
        console.log('Signature Valid:', isValid);
        
        // Example: Get current gas price
        const publicClient = ethereumService.getPublicClient();
        const gasPrice = await publicClient.getGasPrice();
        console.log('Current Gas Price:', gasPrice.toString(), 'wei');
        
    } catch (error) {
        console.error('Error in Ethereum example:', error);
    }
}

// Uncomment the line below to run the example
// ethereumExample();

export { ethereumExample };
