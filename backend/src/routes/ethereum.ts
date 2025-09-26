import { Router, Request, Response } from 'express';
import { ethereumService } from '../services/ethereum.js';

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
                balance: balance.toString(),
                currency: 'ETH',
                network: network.name,
                chainId: network.id.toString()
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

// Verify a signature
router.post('/verify-signature', async (req: Request, res: Response) => {
    try {
        const { message, signature } = req.body;
        
        if (!message || !signature) {
            res.status(400).json({
                success: false,
                error: 'Message and signature are required'
            });
        }
        
        const isValid = await ethereumService.verifyMessage(message, signature);
        const signerAddress = ethereumService.getAddress();
        
        res.json({
            success: true,
            data: {
                message,
                signature,
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
        const publicClient = ethereumService.getPublicClient();
        const network = await ethereumService.getNetwork();
        const gasPrice = await publicClient.getGasPrice();
        
        res.json({
            success: true,
            data: {
                name: network.name,
                chainId: network.id.toString(),
                gasPrice: gasPrice.toString()
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
