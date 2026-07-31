import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqualString } from '../security/tokens.js';

const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const failureWindowMs = 5 * 60 * 1000;
const maximumFailures = 10;

function requireConfiguredSecret(
  environmentName: 'ADMIN_PASSWORD' | 'CRON_JOB_AUTHORIZATION',
  req: Request,
  suppliedSecret: unknown,
  res: Response,
  next: NextFunction
): void {
  const attemptKey = `${environmentName}:${reqIp(req)}`;
  const now = Date.now();
  const attempts = failedAttempts.get(attemptKey);
  if (attempts && attempts.resetAt > now && attempts.count >= maximumFailures) {
    res.status(429).json({ error: 'Too many failed authorization attempts' });
    return;
  }

  const configuredSecret = process.env[environmentName];
  if (!configuredSecret) {
    console.error(`${environmentName} is not configured; privileged endpoint rejected.`);
    res.status(503).json({ error: 'Privileged operations are not configured' });
    return;
  }

  if (!timingSafeEqualString(suppliedSecret, configuredSecret)) {
    failedAttempts.set(attemptKey, {
      count: attempts && attempts.resetAt > now ? attempts.count + 1 : 1,
      resetAt: attempts && attempts.resetAt > now ? attempts.resetAt : now + failureWindowMs
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  failedAttempts.delete(attemptKey);
  next();
}

function reqIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireConfiguredSecret('ADMIN_PASSWORD', req, req.header('x-admin-password'), res, next);
}

export function requireCron(req: Request, res: Response, next: NextFunction): void {
  requireConfiguredSecret('CRON_JOB_AUTHORIZATION', req, req.header('authorization'), res, next);
}
