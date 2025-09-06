import { Router, Request, Response } from 'express';
import { ethereumService } from '../services/ethereum';

const router = Router();

// Get wallet information
router.get('/wallet-info', async (req: Request, res: Response) => {
    try {
        const address = ethereumService.getAddress();
        const balance = await ethereumService.getBalance();
        const network = await ethereumService.getNetwork();
        
        res.json({
            success: true,
            data: {
                address,
                balance: `${balance} ETH`,
                network: network.name,
                chainId: network.chainId.toString()
            }
        });
    } catch (error) {
        console.error('Error getting wallet info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get wallet information'
        });
    }
});

// Sign a message
router.post('/sign-message', async (req: Request, res: Response) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }
        
        const signature = await ethereumService.signMessage(message);
        const address = ethereumService.getAddress();
        
        res.json({
            success: true,
            data: {
                message,
                signature,
                address
            }
        });
    } catch (error) {
        console.error('Error signing message:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sign message'
        });
    }
});

// Verify a signature
router.post('/verify-signature', async (req: Request, res: Response) => {
    try {
        const { message, signature } = req.body;
        
        if (!message || !signature) {
            return res.status(400).json({
                success: false,
                error: 'Message and signature are required'
            });
        }
        
        const recoveredAddress = ethereumService.verifyMessage(message, signature);
        const signerAddress = ethereumService.getAddress();
        const isValid = recoveredAddress.toLowerCase() === signerAddress.toLowerCase();
        
        res.json({
            success: true,
            data: {
                message,
                signature,
                recoveredAddress,
                signerAddress,
                isValid
            }
        });
    } catch (error) {
        console.error('Error verifying signature:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify signature'
        });
    }
});

// Get network information
router.get('/network', async (req: Request, res: Response) => {
    try {
        const provider = ethereumService.getProvider();
        const network = await provider.getNetwork();
        const feeData = await provider.getFeeData();
        
        res.json({
            success: true,
            data: {
                name: network.name,
                chainId: network.chainId.toString(),
                gasPrice: feeData.gasPrice?.toString(),
                maxFeePerGas: feeData.maxFeePerGas?.toString(),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
            }
        });
    } catch (error) {
        console.error('Error getting network info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get network information'
        });
    }
});

export default router;
