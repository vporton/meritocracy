import type { NextFunction, Request, Response } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Lightweight per-process protection for authentication endpoints. Deployments
 * with multiple API instances should additionally enforce a shared limit at the
 * edge or replace this with a shared store.
 */
export function fixedWindowRateLimit({ windowMs, max, name }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${name}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: 'Too many requests; try again later' });
      return;
    }

    // Keep the bounded in-memory map from accumulating dead client entries.
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    next();
  };
}
