/**
 * Black-box characterization suite for the currently running API.
 * Run only against a disposable deployment:
 *   API_BASE_URL=http://localhost:3001 npx mocha --loader ts-node/esm tests/behavioral/*.ts
 * Optional authenticated checks require TEST_SESSION_TOKEN and TEST_OTHER_USER_ID.
 * It deliberately does not call financial/cleanup/KYC-mutating endpoints.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

const baseUrl = process.env.API_BASE_URL;
const token = process.env.TEST_SESSION_TOKEN;
const otherUserId = process.env.TEST_OTHER_USER_ID;
const run = baseUrl ? describe : describe.skip;
const request = async (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

run('current HTTP API characterization', () => {
  it('reports the public API banner', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Meritocracy API Server');
  });

  it('rejects unauthenticated owner-only GDP access', async () => {
    const res = await request('/api/users/me/gdp-share');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Authentication required');
  });

  it('validates malformed ban vote request before service execution', async () => {
    const res = await request('/api/ban-voting/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 401, 'authentication middleware runs before body validation');
  });

  it('limits leaderboard requests to 100 according to response metadata', async () => {
    const res = await request('/api/users/leaderboard?limit=999999');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.limit, 100);
  });

  it('rejects invalid global log filter type', async () => {
    const res = await request('/api/logs?type=not-a-log');
    assert.equal(res.status, 400);
  });

  it('requires cron credential', async () => {
    const res = await request('/api/cron/weekly-gas-distribution', { method: 'POST' });
    assert.ok([401, 500].includes(res.status), '401 when configured; 500 when CRON_JOB_AUTHORIZATION is absent');
  });

  const authRun = token && otherUserId ? it : it.skip;
  authRun('rejects cross-owner user update', async () => {
    const res = await request(`/api/users/${otherUserId}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'must not be written' }) });
    assert.equal(res.status, 403);
  });

  authRun('rejects cross-owner log lookup', async () => {
    const res = await request(`/api/logs/user/${otherUserId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 403);
  });
});
