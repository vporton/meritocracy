import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { fixedWindowRateLimit } from '../src/middleware/rateLimit.js';
import { requireAdmin } from '../src/middleware/privilegedAuth.js';
import {
  createOpaqueToken,
  hashOpaqueToken,
  signOAuthState,
  timingSafeEqualString,
  verifyOAuthState,
  type OAuthStatePayload,
} from '../src/security/tokens.js';

function mockHttp(ip = '127.0.0.1', headers: Record<string, string> = {}) {
  let statusCode = 200;
  let body: unknown;
  const responseHeaders = new Map<string, string>();
  const req = {
    ip,
    socket: {},
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => responseHeaders.set(name, value),
    status: (value: number) => {
      statusCode = value;
      return res;
    },
    json: (value: unknown) => {
      body = value;
      return res;
    },
  } as unknown as Response;
  return { req, res, responseHeaders, get statusCode() { return statusCode; }, get body() { return body; } };
}

describe('security token primitives', () => {
  it('creates unpredictable bearer values and stores only deterministic digests', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    assert.notEqual(first, second);
    assert.ok(first.length >= 43);
    assert.notEqual(hashOpaqueToken(first), first);
    assert.equal(hashOpaqueToken(first), hashOpaqueToken(first));
  });

  it('compares secrets without accepting non-string or partial values', () => {
    assert.equal(timingSafeEqualString('correct horse', 'correct horse'), true);
    assert.equal(timingSafeEqualString('correct horse', 'correct'), false);
    assert.equal(timingSafeEqualString(undefined, 'correct horse'), false);
  });

  it('rejects tampered and malformed OAuth state', () => {
    const payload: OAuthStatePayload = {
      provider: 'github',
      nonce: createOpaqueToken(24),
      userId: 42,
      expiresAt: Date.now() + 60_000,
    };
    const state = signOAuthState(payload, 'a-secure-test-secret-that-is-at-least-32-bytes');
    assert.deepEqual(verifyOAuthState(state, 'a-secure-test-secret-that-is-at-least-32-bytes'), payload);
    assert.equal(verifyOAuthState(`${state}x`, 'a-secure-test-secret-that-is-at-least-32-bytes'), null);
    assert.equal(verifyOAuthState(state, 'the-wrong-secret-that-is-also-long-enough'), null);
    assert.equal(verifyOAuthState('not-a-state', 'a-secure-test-secret-that-is-at-least-32-bytes'), null);
  });
});

describe('privileged authentication', () => {
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
  });

  it('fails closed when the administrator secret is missing', () => {
    delete process.env.ADMIN_PASSWORD;
    const http = mockHttp('192.0.2.1');
    let nextCalled = false;
    requireAdmin(http.req, http.res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(http.statusCode, 503);
    assert.equal(nextCalled, false);
  });

  it('rejects a wrong secret and accepts an exact secret', () => {
    process.env.ADMIN_PASSWORD = 'correct-admin-secret';
    const wrong = mockHttp('192.0.2.2', { 'x-admin-password': 'wrong' });
    requireAdmin(wrong.req, wrong.res, (() => assert.fail('wrong secret reached handler')) as NextFunction);
    assert.equal(wrong.statusCode, 401);

    const correct = mockHttp('192.0.2.3', { 'x-admin-password': 'correct-admin-secret' });
    let nextCalled = false;
    requireAdmin(correct.req, correct.res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
  });
});

describe('authentication endpoint rate limiting', () => {
  it('returns 429 after the configured request count', () => {
    const middleware = fixedWindowRateLimit({ name: 'test', max: 2, windowMs: 60_000 });
    const first = mockHttp('198.51.100.5');
    const second = mockHttp('198.51.100.5');
    const third = mockHttp('198.51.100.5');
    let calls = 0;
    const next = (() => { calls += 1; }) as NextFunction;
    middleware(first.req, first.res, next);
    middleware(second.req, second.res, next);
    middleware(third.req, third.res, next);
    assert.equal(calls, 2);
    assert.equal(third.statusCode, 429);
    assert.equal(third.responseHeaders.get('Retry-After') !== undefined, true);
  });
});
