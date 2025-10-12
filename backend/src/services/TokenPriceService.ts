import fetch from 'node-fetch';
import type { TokenPriceMetadata } from '../types/token.js';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

export const COINGECKO_PLATFORM_BY_NETWORK: Record<string, string> = {
  mainnet: 'ethereum',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  base: 'base',
  polygon: 'polygon-pos',
  celo: 'celo',
  mezo: 'bitcoin',
  sepolia: 'ethereum',
  mezoTestnet: 'bitcoin',
  localhost: 'ethereum'
};

export interface TokenPriceQuery extends TokenPriceMetadata {
  networkName?: string;
  tokenAddress?: `0x${string}`;
}

export class TokenPriceService {
  static async getTokenPriceUsd(query: TokenPriceQuery): Promise<number> {
    const fallbackPrice = query.fallbackPriceUsd ?? 1;

    try {
      if (query.coingeckoId) {
        const price = await this.fetchCoingeckoPrice(query.coingeckoId);
        if (price !== null) {
          return price;
        }
      }

      if (query.tokenType === 'ERC20') {
        const platform = query.coingeckoPlatformId ?? (query.networkName ? COINGECKO_PLATFORM_BY_NETWORK[query.networkName] : undefined);
        const tokenAddress = query.tokenAddress;

        if (platform && tokenAddress) {
          const price = await this.fetchCoingeckoTokenPrice(platform, tokenAddress);
          if (price !== null) {
            return price;
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching price for ${query.tokenSymbol}:`, error);
    }

    return fallbackPrice;
  }

  static async fetchCoingeckoPrice(coingeckoId: string): Promise<number | null> {
    try {
      const response = await fetch(`${COINGECKO_BASE_URL}/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as Record<string, { usd: number }>;
      const price = data[coingeckoId]?.usd;
      return typeof price === 'number' ? price : null;
    } catch (error) {
      console.error(`Failed to fetch CoinGecko price for ${coingeckoId}:`, error);
      return null;
    }
  }

  static async fetchCoingeckoTokenPrice(platformId: string, contractAddress: `0x${string}`): Promise<number | null> {
    try {
      const response = await fetch(`${COINGECKO_BASE_URL}/simple/token_price/${platformId}?contract_addresses=${contractAddress.toLowerCase()}&vs_currencies=usd`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as Record<string, { usd: number }>;
      const price = data[contractAddress.toLowerCase()]?.usd;
      return typeof price === 'number' ? price : null;
    } catch (error) {
      console.error(`Failed to fetch CoinGecko token price for ${contractAddress} on ${platformId}:`, error);
      return null;
    }
  }
}
