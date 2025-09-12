import express from 'express';
import { GlobalDataService } from '../services/GlobalDataService';

const router = express.Router();

/**
 * GET /api/global/gdp
 * Get current world GDP data
 */
router.get('/gdp', async (req, res) => {
  try {
    const worldGdp = await GlobalDataService.getWorldGdp();
    
    if (worldGdp === null) {
      return res.status(404).json({
        success: false,
        message: 'World GDP data not available',
        data: null
      });
    }
    
    return res.json({
      success: true,
      message: 'World GDP data retrieved successfully',
      data: {
        worldGdp,
        formatted: `$${worldGdp.toLocaleString()}`,
        currency: 'USD',
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting world GDP:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Something went wrong'
    });
  }
});

/**
 * POST /api/global/refresh-gdp
 * Manually refresh world GDP data
 */
router.post('/refresh-gdp', async (req, res) => {
  try {
    const success = await GlobalDataService.fetchAndUpdateWorldGdp();
    
    if (success) {
      const worldGdp = await GlobalDataService.getWorldGdp();
      return res.json({
        success: true,
        message: 'World GDP data refreshed successfully',
        data: {
          worldGdp,
          formatted: worldGdp ? `$${worldGdp.toLocaleString()}` : 'N/A',
          currency: 'USD',
          lastUpdated: new Date().toISOString()
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to refresh world GDP data',
        data: null
      });
    }
  } catch (error) {
    console.error('Error refreshing world GDP:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Something went wrong'
    });
  }
});

export default router;
