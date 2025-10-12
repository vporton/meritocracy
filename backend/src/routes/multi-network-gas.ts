import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { MultiNetworkGasTokenDistributionService, type TokenDistributionOptions } from '../services/MultiNetworkGasTokenDistributionService.js';
import { multiNetworkEthereumService } from '../services/MultiNetworkEthereumService.js';

const router = Router();
const prisma = new PrismaClient();
const multiNetworkGasTokenDistributionService = new MultiNetworkGasTokenDistributionService(prisma);

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
};

const parseTokenDistributionOverrides = (source: any): TokenDistributionOptions => {
  const overrides: TokenDistributionOptions = {};
  if (!source || typeof source !== 'object') {
    return overrides;
  }

  const {
    tokenType,
    minimumDistributionAmount,
    minimumDistributionUsd
  } = source;

  if (typeof tokenType === 'string') {
    const normalized = tokenType.toUpperCase();
    if (normalized === 'NATIVE') {
      overrides.tokenType = normalized as TokenDistributionOptions['tokenType'];
    }
  }

  const minValue = parseNumber(minimumDistributionAmount ?? minimumDistributionUsd);
  if (minValue !== undefined) {
    overrides.minimumDistributionAmount = minValue;
  }

  return overrides;
};

/**
 * GET /api/multi-network-gas/status
 * Get status of all enabled networks
 */
router.get('/status', async (req, res) => {
  try {
    const overrides = parseTokenDistributionOverrides(req.query);
    const networkStatus = await multiNetworkGasTokenDistributionService.getNetworkStatus(overrides);
    const enabledNetworks = multiNetworkEthereumService.getEnabledNetworks();
    
    const status = {
      enabledNetworks,
      networks: Object.fromEntries(networkStatus),
      totalNetworks: enabledNetworks.length,
      token: {
        type: overrides.tokenType ?? 'NATIVE',
        minimumDistributionAmount: overrides.minimumDistributionAmount
      }
    };

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting multi-network status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/reserve-status
 * Get reserve status for all networks
 */
router.get('/reserve-status', async (req, res) => {
  try {
    const overrides = parseTokenDistributionOverrides(req.query);
    const reserveStatus = await multiNetworkGasTokenDistributionService.getReserveStatus(overrides);
    
    res.json({
      success: true,
      data: Object.fromEntries(reserveStatus),
      token: {
        type: overrides.tokenType ?? 'NATIVE',
        minimumDistributionAmount: overrides.minimumDistributionAmount
      }
    });
  } catch (error) {
    console.error('Error getting reserve status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/distribution-history
 * Get distribution history across all networks
 */
router.get('/distribution-history', async (req, res) => {
  try {
    const { network, userId, limit = 100 } = req.query;
    
    let distributions;
    if (network && typeof network === 'string') {
      distributions = await multiNetworkGasTokenDistributionService.getNetworkDistributionHistory(network);
    } else if (userId && typeof userId === 'string') {
      distributions = await multiNetworkGasTokenDistributionService.getUserDistributionHistory(parseInt(userId));
    } else {
      distributions = await multiNetworkGasTokenDistributionService.getAllDistributionHistory();
    }

    // Apply limit
    const limitedDistributions = distributions.slice(0, parseInt(limit as string));

    res.json({
      success: true,
      data: limitedDistributions,
      total: distributions.length,
      returned: limitedDistributions.length
    });
  } catch (error) {
    console.error('Error getting distribution history:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/network/:networkName/status
 * Get detailed status for a specific network
 */
router.get('/network/:networkName/status', async (req, res) => {
  try {
    const { networkName } = req.params;
    const overrides = parseTokenDistributionOverrides(req.query);
    
    const networkInfo = await multiNetworkEthereumService.getNetworkInfo(networkName);
    const reserveStatus = await multiNetworkGasTokenDistributionService.getReserveStatus(overrides);
    const networkReserve = reserveStatus.get(networkName);
    
    const status = {
      ...networkInfo,
      ...networkReserve,
      balanceFormatted: multiNetworkEthereumService.formatEther(networkInfo.balance),
      gasPriceFormatted: multiNetworkEthereumService.formatEther(networkInfo.gasPrice)
    };

    res.json({
      success: true,
      data: status,
      token: {
        type: overrides.tokenType ?? networkReserve?.tokenType ?? 'NATIVE',
        minimumDistributionAmount: overrides.minimumDistributionAmount ?? networkReserve?.minimumDistributionUsd
      }
    });
  } catch (error) {
    console.error(`Error getting status for network ${req.params.networkName}:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/network/:networkName/distribution-history
 * Get distribution history for a specific network
 */
router.get('/network/:networkName/distribution-history', async (req, res) => {
  try {
    const { networkName } = req.params;
    const { limit = 100 } = req.query;
    
    const distributions = await multiNetworkGasTokenDistributionService.getNetworkDistributionHistory(networkName);
    const limitedDistributions = distributions.slice(0, parseInt(limit as string));

    res.json({
      success: true,
      data: limitedDistributions,
      total: distributions.length,
      returned: limitedDistributions.length,
      network: networkName
    });
  } catch (error) {
    console.error(`Error getting distribution history for network ${req.params.networkName}:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/user/:userId/distribution-history
 * Get distribution history for a specific user across all networks
 */
router.get('/user/:userId/distribution-history', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;
    
    const distributions = await multiNetworkGasTokenDistributionService.getUserDistributionHistory(parseInt(userId));
    const limitedDistributions = distributions.slice(0, parseInt(limit as string));

    res.json({
      success: true,
      data: limitedDistributions,
      total: distributions.length,
      returned: limitedDistributions.length,
      userId: parseInt(userId)
    });
  } catch (error) {
    console.error(`Error getting distribution history for user ${req.params.userId}:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/multi-network-gas/run-distribution
 * Manually trigger multi-network gas token distribution
 * Note: This endpoint should be protected in production
 */
router.post('/run-distribution', async (req, res) => {
  try {
    console.log('🔄 Manual multi-network gas token distribution triggered via API');
    
    const overrides = parseTokenDistributionOverrides(req.body);
    const result = await multiNetworkGasTokenDistributionService.processMultiNetworkDistribution(overrides);
    
    res.json({
      success: result.success,
      data: {
        totalDistributed: result.totalDistributed,
        totalReserved: result.totalReserved,
        networkResults: Object.fromEntries(result.networkResults),
        errors: result.errors,
        token: {
          type: overrides.tokenType ?? 'NATIVE',
          minimumDistributionAmount: overrides.minimumDistributionAmount
        }
      },
      overrides
    });
  } catch (error) {
    console.error('Error running multi-network gas token distribution:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
