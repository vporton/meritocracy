import fetch from 'node-fetch';
import { prisma } from '../lib/prisma.js';

export class GlobalDataService {
  private static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Fetches world GDP data from World Bank API
   * @returns Promise<number | null> - GDP value in current US dollars or null if failed
   */
  static async fetchWorldGdp(): Promise<number | null> {
    try {
      const url = 'http://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD?format=json&per_page=1';
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as any[];

      if (data && data.length > 1 && data[1] && data[1].length > 0) {
        const gdpValue = data[1][0].value;
        return gdpValue ? parseFloat(gdpValue) : null;
      }

      return null;
    } catch (error) {
      console.error('Error fetching world GDP:', error);
      return null;
    }
  }

  /**
   * Gets the current world GDP from database
   * @returns Promise<number | null> - Current GDP value or null if not available
   */
  static async getWorldGdp(): Promise<number | null> {
    try {
      const globalData = await prisma.global.findFirst();
      return globalData?.worldGdp || null;
    } catch (error) {
      console.error('Error getting world GDP from database:', error);
      return null;
    }
  }

  /**
   * Updates world GDP in database
   * @param gdpValue - GDP value to store
   * @returns Promise<boolean> - Success status
   */
  static async updateWorldGdp(gdpValue: number): Promise<boolean> {
    try {
      // Get or create the single global record
      const globalData = await prisma.global.upsert({
        where: { id: 1 },
        update: { worldGdp: gdpValue },
        create: { worldGdp: gdpValue }
      });

      console.log(`World GDP updated: $${gdpValue.toLocaleString()}`);
      return true;
    } catch (error) {
      console.error('Error updating world GDP:', error);
      return false;
    }
  }

  /**
   * Fetches and updates world GDP data
   * @returns Promise<boolean> - Success status
   */
  static async fetchAndUpdateWorldGdp(): Promise<boolean> {
    try {
      const gdpValue = await this.fetchWorldGdp();

      if (gdpValue === null) {
        console.error('Failed to fetch world GDP data');
        return false;
      }

      return await this.updateWorldGdp(gdpValue);
    } catch (error) {
      console.error('Error in fetchAndUpdateWorldGdp:', error);
      return false;
    }
  }

  /**
   * Initializes global data on startup if not present
   * @returns Promise<boolean> - Success status
   */
  static async initializeGlobalData(): Promise<boolean> {
    try {
      const currentGdp = await this.getWorldGdp();

      if (currentGdp === null) {
        console.log('No world GDP data found, fetching...');
        return await this.fetchAndUpdateWorldGdp();
      } else {
        console.log(`Current world GDP: $${currentGdp.toLocaleString()}`);
        return true;
      }
    } catch (error) {
      console.error('Error initializing global data:', error);
      return false;
    }
  }

  /**
   * Checks if GDP data needs to be updated (older than 1 month)
   * @returns Promise<boolean> - True if update is needed
   */
  static async shouldUpdateGdp(): Promise<boolean> {
    try {
      const globalData = await prisma.global.findFirst();

      if (!globalData) {
        return true;
      }

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      return globalData.updatedAt < oneMonthAgo;
    } catch (error) {
      console.error('Error checking if GDP should be updated:', error);
      return true; // Default to updating if there's an error
    }
  }

  /**
   * Checks if gas distribution is enabled
   * @returns Promise<boolean> - True if gas distribution is enabled
   */
  static async isGasDistributionEnabled(): Promise<boolean> {
    try {
      const globalData = await prisma.global.findFirst();
      return globalData?.gasDistributionEnabled ?? true;
    } catch (error) {
      console.error('Error checking if gas distribution is enabled:', error);
      return true; // Default to true if there's an error
    }
  }

  /**
   * Sets the gas distribution enabled status
   * @param enabled - Whether gas distribution should be enabled
   * @returns Promise<boolean> - Success status
   */
  static async setGasDistributionEnabled(enabled: boolean): Promise<boolean> {
    try {
      await prisma.global.upsert({
        where: { id: 1 },
        update: { gasDistributionEnabled: enabled },
        create: { gasDistributionEnabled: enabled }
      });
      console.log(`Gas distribution enabled set to: ${enabled}`);
      return true;
    } catch (error) {
      console.error('Error setting gas distribution enabled status:', error);
      return false;
    }
  }

  /**
   * Recomputes and stores aggregated salary stats from current user shares.
   * Should be called right after a full worth re-evaluation cycle.
   */
  static async recomputeAndStoreSalaryStats(): Promise<boolean> {
    try {
      const globalData = await prisma.global.findFirst({
        select: {
          worldGdp: true
        }
      });

      if (!globalData?.worldGdp) {
        console.error('Cannot recompute salary stats: world GDP is not available');
        return false;
      }

      const shareRows = await prisma.user.findMany({
        where: {
          shareInGDP: {
            not: null
          }
        },
        select: {
          shareInGDP: true
        }
      });

      const shareValues = shareRows.map(user => Number(user.shareInGDP ?? 0));
      const totalShare = shareValues.reduce((sum, value) => sum + value, 0);
      const averageShare = shareValues.length ? totalShare / shareValues.length : 0;
      const medianShare = this.calculateMedian(shareValues);

      const multiplier = globalData.worldGdp;
      const toCurrency = (shareFraction: number) => shareFraction * multiplier;

      await prisma.global.upsert({
        where: {
          id: 1
        },
        update: {
          salaryStatsUserCount: shareValues.length,
          salaryStatsTotal: toCurrency(totalShare),
          salaryStatsAverage: toCurrency(averageShare),
          salaryStatsMedian: toCurrency(medianShare),
          salaryStatsCalculatedAt: new Date()
        },
        create: {
          worldGdp: multiplier,
          salaryStatsUserCount: shareValues.length,
          salaryStatsTotal: toCurrency(totalShare),
          salaryStatsAverage: toCurrency(averageShare),
          salaryStatsMedian: toCurrency(medianShare),
          salaryStatsCalculatedAt: new Date()
        }
      });

      return true;
    } catch (error) {
      console.error('Error recomputing and storing salary stats:', error);
      return false;
    }
  }
}
