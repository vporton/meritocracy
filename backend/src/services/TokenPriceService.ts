import fetch from 'node-fetch';

export interface TokenPriceQuote {
  symbol: string;
  coinId: string;
  usd: number;
  lastUpdatedAt: string | null;
  source: 'coingecko';
}

type CachedTokenPriceQuote = {
  quote: TokenPriceQuote;
  timestamp: number;
};

const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  ATOM: 'cosmos',
  BCH: 'bitcoin-cash',
  BTC: 'bitcoin',
  CELO: 'celo',
  CKBTC: 'bitcoin',
  CKETH: 'ethereum',
  CKEURC: 'euro-coin',
  CKUSDC: 'usd-coin',
  CKUSDT: 'tether',
  DOT: 'polkadot',
  ETH: 'ethereum',
  ICP: 'internet-computer',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  SOL: 'solana',
  USDC: 'usd-coin',
  USDT: 'tether',
  XLM: 'stellar'
};

export class TokenPriceService {
  private static readonly cache = new Map<string, CachedTokenPriceQuote>();
  private static readonly CACHE_TTL_MS = 55_000;
  private static readonly API_URL = 'https://api.coingecko.com/api/v3/simple/price';

  static getSupportedSymbols(): string[] {
    return Object.keys(SYMBOL_TO_COINGECKO_ID);
  }

  static async getUsdQuotes(symbols: string[]): Promise<Record<string, TokenPriceQuote>> {
    const normalizedSymbols = Array.from(
      new Set(
        symbols
          .map(symbol => symbol.trim().toUpperCase())
          .filter(symbol => symbol.length > 0)
      )
    );

    const supportedSymbols = normalizedSymbols.filter(symbol => SYMBOL_TO_COINGECKO_ID[symbol]);
    if (supportedSymbols.length === 0) {
      return {};
    }

    const now = Date.now();
    const quotes: Record<string, TokenPriceQuote> = {};
    const missingSymbols: string[] = [];

    for (const symbol of supportedSymbols) {
      const cached = this.cache.get(symbol);
      if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
        quotes[symbol] = cached.quote;
      } else {
        missingSymbols.push(symbol);
      }
    }

    if (missingSymbols.length === 0) {
      return quotes;
    }

    const coinIds = Array.from(
      new Set(missingSymbols.map(symbol => SYMBOL_TO_COINGECKO_ID[symbol]))
    );
    const url = new URL(this.API_URL);
    url.searchParams.set('ids', coinIds.join(','));
    url.searchParams.set('vs_currencies', 'usd');
    url.searchParams.set('include_last_updated_at', 'true');
    url.searchParams.set('precision', 'full');

    const headers: Record<string, string> = {};
    if (process.env.COINGECKO_DEMO_API_KEY) {
      headers['x-cg-demo-api-key'] = process.env.COINGECKO_DEMO_API_KEY;
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`CoinGecko price request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as Record<string, { usd?: number; last_updated_at?: number }>;

    for (const symbol of missingSymbols) {
      const coinId = SYMBOL_TO_COINGECKO_ID[symbol];
      const priceEntry = payload[coinId];
      if (!priceEntry || typeof priceEntry.usd !== 'number' || !Number.isFinite(priceEntry.usd)) {
        continue;
      }

      const quote: TokenPriceQuote = {
        symbol,
        coinId,
        usd: priceEntry.usd,
        lastUpdatedAt:
          typeof priceEntry.last_updated_at === 'number'
            ? new Date(priceEntry.last_updated_at * 1000).toISOString()
            : null,
        source: 'coingecko'
      };

      this.cache.set(symbol, { quote, timestamp: now });
      quotes[symbol] = quote;
    }

    return quotes;
  }
}
