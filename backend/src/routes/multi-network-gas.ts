import { Router } from 'express';
import { multiNetworkGasTokenDistributionService } from '../services/MultiNetworkGasTokenDistributionService.js';
import type { TokenDistributionOptions } from '../services/gas-networks/types.js';
import { multiNetworkEthereumService } from '../services/MultiNetworkEthereumService.js';

const router = Router();

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
    country,
  } = source;

  if (typeof tokenType === 'string') {
    const normalized = tokenType.toUpperCase();
    if (normalized === 'NATIVE') {
      overrides.tokenType = normalized as TokenDistributionOptions['tokenType'];
    }
  }

  if (typeof country === 'string' && country.trim().length === 2) {
    overrides.country = country.trim().toUpperCase();
  }

  return overrides;
};

/**
 * GET /api/multi-network-gas/list
 * Get list of all enabled networks (fast, no balances)
 */
router.get('/list', async (req, res) => {
  try {
    const overrides = parseTokenDistributionOverrides(req.query);
    const enabledNetworkDetails = await multiNetworkGasTokenDistributionService.getEnabledNetworks(overrides);
    const enabledNetworks = enabledNetworkDetails.map(network => network.networkId);

    res.json({
      success: true,
      data: {
        enabledNetworks,
        networkDetails: enabledNetworkDetails,
        totalNetworks: enabledNetworks.length,
        token: {
          type: overrides.tokenType ?? 'NATIVE',
        }
      }
    });
  } catch (error) {
    console.error('Error getting multi-network list:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/multi-network-gas/status
 * Get status of all enabled networks
 */
router.get('/status', async (req, res) => {
  try {
    const overrides = parseTokenDistributionOverrides(req.query);
    const enabledNetworkDetails = await multiNetworkGasTokenDistributionService.getEnabledNetworks(overrides);
    const networkStatus = await multiNetworkGasTokenDistributionService.getNetworkStatus(overrides);
    const enabledNetworks = enabledNetworkDetails.map(network => network.networkId);

    let totalAvailable = 0;
    let totalReserve = 0;
    for (const entry of networkStatus.values()) {
      totalAvailable += entry.availableForDistribution;
      totalReserve += entry.totalReserve;
    }

    const status = {
      enabledNetworks,
      networkDetails: enabledNetworkDetails,
      networks: Object.fromEntries(networkStatus),
      totalNetworks: enabledNetworks.length,
      totalAvailable,
      totalReserve,
      token: {
        type: overrides.tokenType ?? 'NATIVE',
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
    const status = await multiNetworkGasTokenDistributionService.getSingleNetworkStatus(networkName, overrides);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: `Network ${networkName} not found`
      });
    }

    return res.json({
      success: true,
      data: status,
      token: {
        type: overrides.tokenType ?? status.tokenType ?? 'NATIVE',
      }
    });
  } catch (error) {
    console.error(`Error getting status for network %s: %s`, req.params.networkName, error);
    return res.status(500).json({
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
    console.error(`Error getting distribution history for network %s: %s`, req.params.networkName, error);
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
    console.error(`Error getting distribution history for user %s: %s`, req.params.userId, error);
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
      data: {
        networkResults: Object.fromEntries(result.networkResults),
        errors: result.errors,
        token: {
          type: overrides.tokenType ?? 'NATIVE',
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

/**
 * POST /api/multi-network-gas/ensure-country-account
 * Create accounts for a specific country if they don't exist
 */
router.post('/ensure-country-account', async (req, res) => {
  try {
    const { country } = req.body;
    if (!country || typeof country !== 'string' || country.length !== 2) {
      return res.status(400).json({ success: false, error: 'Invalid country code (must be 2 chars)' });
    }

    const enabledNetworkDetails = await multiNetworkGasTokenDistributionService.getEnabledNetworks();
    const results: Record<string, boolean> = {};

    // We need to import systemSecretService here or access it safely.
    // Since it's a singleton, we can import it.
    // But imports are top-level. I will add import at top or just assume it's available via service?
    // MultiNetworkGasTokenDistributionService doesn't expose secret service directly.
    // I'll import it at the top of the file in the next step or rely on Dynamic import?
    // Better: Add top-level import.
    const { systemSecretService } = await import('../services/SystemSecretService.js');

    for (const net of enabledNetworkDetails) {
      await systemSecretService.ensureCountrySecret(net.networkId, country.toUpperCase());
      results[net.networkId] = true;
    }

    // Clear context cache to ensure new secrets are picked up immediately
    multiNetworkGasTokenDistributionService.clearContextCache();

    return res.json({
      success: true,
      created: true,
      networks: results
    });
  } catch (error) {
    console.error('Error ensuring country account:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
