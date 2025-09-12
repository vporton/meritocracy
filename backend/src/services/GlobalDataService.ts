import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

const prisma = new PrismaClient();

export class GlobalDataService {
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
}
