import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory } from '../frontend/src/declarations/registry/registry.did.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const siteUrl = 'https://registry.meritocracy.test';
const appRedirect = 'https://app.meritocracy.test/oauth/complete';

const callbackRequest = (provider, state, code = 'github-test-code') => ({
  url: `/auth/${provider}/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
  method: 'GET',
  body: new Uint8Array(),
  headers: [],
});

const header = (headers, name) =>
  headers.find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1];

async function pendingOutcall(pic) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await pic.tick(2);
    const pending = await pic.getPendingHttpsOutcalls();
    if (pending.length === 1) return pending[0];
    assert.equal(pending.length, 0, 'expected at most one pending HTTPS outcall');
  }
  assert.fail('expected exactly one pending HTTPS outcall');
}

async function mockJson(pic, request, value, contentType = 'application/json; charset=utf-8') {
  await pic.mockPendingHttpsOutcall({
    requestId: request.requestId,
    subnetId: request.subnetId,
    response: {
      type: 'success',
      statusCode: 200,
      headers: [['content-type', contentType]],
      body: encoder.encode(JSON.stringify(value)),
    },
  });
}

test('registry completes GitHub OAuth through bounded HTTPS outcalls and rejects replay', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy oauth integration controller');
  const session = createIdentity('meritocracy oauth browser session');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm: readFileSync('.mops/.build/registry.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registry = fixture.actor;
  registry.setIdentity(controller);
  const configured = await registry.configure_authorities({
    rounds_canister: [],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: [],
    allowed_actions: [],
    oauth_site_url: siteUrl,
    oauth_providers: [{ kind: { github: null }, client_id: 'github-client-id' }],
    oauth_redirect_uris: [appRedirect],
  });
  assert.ok('ok' in configured);

  registry.setIdentity(session);
  const started = await registry.begin_oauth_login({
    provider: 'github',
    session_principal: session.getPrincipal(),
    redirect_uri: appRedirect,
  });
  assert.ok('ok' in started);
  const loginUrl = new URL(started.ok.login_url);
  assert.equal(loginUrl.origin + loginUrl.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loginUrl.searchParams.get('client_id'), 'github-client-id');
  assert.equal(loginUrl.searchParams.get('redirect_uri'), `${siteUrl}/auth/github/callback`);
  assert.equal(loginUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(loginUrl.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  const state = loginUrl.searchParams.get('state');
  assert.match(state ?? '', /^[A-Za-z0-9_-]{43}$/);

  const deferred = pic.createDeferredActor(idlFactory, fixture.canisterId);
  const finishCallback = await deferred.http_request_update(callbackRequest('github', state));

  const tokenRequest = await pendingOutcall(pic);
  assert.equal(tokenRequest.httpMethod, 'POST');
  assert.equal(tokenRequest.url, 'https://github.com/login/oauth/access_token');
  assert.equal(tokenRequest.maxResponseBytes, 32_768);
  assert.equal(header(tokenRequest.headers, 'accept'), 'application/json');
  const tokenBody = new URLSearchParams(decoder.decode(tokenRequest.body));
  assert.equal(tokenBody.get('code'), 'github-test-code');
  assert.equal(tokenBody.get('client_id'), 'github-client-id');
  assert.equal(tokenBody.get('redirect_uri'), `${siteUrl}/auth/github/callback`);
  assert.match(tokenBody.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43}$/);
  await mockJson(pic, tokenRequest, { access_token: 'github-access-token', token_type: 'bearer' });

  const userRequest = await pendingOutcall(pic);
  assert.equal(userRequest.httpMethod, 'GET');
  assert.equal(userRequest.url, 'https://api.github.com/user');
  assert.equal(userRequest.maxResponseBytes, 32_768);
  assert.equal(header(userRequest.headers, 'authorization'), 'Bearer github-access-token');
  await mockJson(pic, userRequest, { id: 42, login: 'oauth-user' });

  const callback = await finishCallback();
  assert.equal(callback.status_code, 302);
  assert.deepEqual(callback.headers, [
    ['location', appRedirect],
    ['cache-control', 'no-store'],
  ]);

  registry.setIdentity(session);
  const me = await registry.me();
  assert.ok('ok' in me);
  assert.ok(me.ok.profile.user_id > 0n);

  const replay = await registry.http_request_update(callbackRequest('github', state));
  assert.equal(replay.status_code, 401);
  assert.equal((await pic.getPendingHttpsOutcalls()).length, 0);
});

test('registry rejects an OAuth provider swap before making an outcall', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });
  const controller = createIdentity('meritocracy oauth swap controller');
  const session = createIdentity('meritocracy oauth swap session');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm: readFileSync('.mops/.build/registry.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  fixture.actor.setIdentity(controller);
  assert.ok('ok' in await fixture.actor.configure_authorities({
    rounds_canister: [], session_consumers: [], attestation_issuers: [],
    allowed_domains: [], allowed_actions: [], oauth_site_url: siteUrl,
    oauth_providers: [
      { kind: { github: null }, client_id: 'github-client-id' },
      { kind: { gitlab: null }, client_id: 'gitlab-client-id' },
    ],
    oauth_redirect_uris: [appRedirect],
  }));
  fixture.actor.setIdentity(session);
  const started = await fixture.actor.begin_oauth_login({
    provider: 'github', session_principal: session.getPrincipal(), redirect_uri: appRedirect,
  });
  assert.ok('ok' in started);
  const state = new URL(started.ok.login_url).searchParams.get('state');
  const swapped = await fixture.actor.http_request_update(callbackRequest('gitlab', state));
  assert.equal(swapped.status_code, 401);
  assert.equal((await pic.getPendingHttpsOutcalls()).length, 0);
});
