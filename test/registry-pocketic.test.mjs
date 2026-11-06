import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { IDL } from '@icp-sdk/core/candid';
import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';
import { Wallet, getBytes } from 'ethers';

import { idlFactory } from '../frontend/src/declarations/registry/registry.did.js';

const adminIdlFactory = ({ IDL: Candid }) => {
  const AppError = Candid.Variant({
    unauthorized: Candid.Null,
    forbidden: Candid.Null,
    not_found: Candid.Null,
    conflict: Candid.Text,
    invalid: Candid.Text,
    expired: Candid.Null,
    rate_limited: Candid.Record({ retry_after_ns: Candid.Nat64 }),
    paused: Candid.Null,
    transient: Candid.Text,
    internal: Candid.Text,
  });
  return Candid.Service({
    configure_authorities: Candid.Func(
      [Candid.Record({
        rounds_canister: Candid.Opt(Candid.Principal),
        session_consumers: Candid.Vec(Candid.Principal),
        attestation_issuers: Candid.Vec(Candid.Record({
          name: Candid.Text,
          caller: Candid.Principal,
          public_key: Candid.Vec(Candid.Nat8),
        })),
        allowed_domains: Candid.Vec(Candid.Text),
        allowed_actions: Candid.Vec(Candid.Text),
      })],
      [Candid.Variant({ ok: Candid.Null, err: AppError })],
      [],
    ),
  });
};

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;

test('registry issues, expires, renews, and revokes II-backed sessions', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy registry integration controller');
  const iiIdentity = createIdentity('meritocracy internet identity subject');
  const sessionOne = createIdentity('meritocracy browser session one');
  const sessionTwo = createIdentity('meritocracy browser session two');
  const wasm = readFileSync('.mops/.build/registry.wasm');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm,
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registry = fixture.actor;
  const admin = pic.createActor(adminIdlFactory, fixture.canisterId);
  admin.setIdentity(controller);

  const configured = await admin.configure_authorities({
    rounds_canister: [],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: ['app.meritocracy.test'],
    allowed_actions: ['login'],
  });
  assert.ok('ok' in configured);

  registry.setIdentity(iiIdentity);
  const issuedOne = await registry.complete_internet_identity_login({
    session_principal: sessionOne.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in issuedOne);
  assert.equal(issuedOne.ok.issuer.internet_identity, null);
  const userId = issuedOne.ok.user_id;

  registry.setIdentity(sessionOne);
  const me = await registry.me();
  assert.ok('ok' in me);
  assert.equal(me.ok.profile.user_id, userId);

  await pic.advanceTime(sevenDaysMs);
  await pic.tick();
  const expired = await registry.me();
  assert.deepEqual(expired, { err: { expired: null } });

  registry.setIdentity(iiIdentity);
  const issuedTwo = await registry.complete_internet_identity_login({
    session_principal: sessionTwo.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in issuedTwo);
  assert.equal(issuedTwo.ok.user_id, userId);

  registry.setIdentity(sessionTwo);
  const revoked = await registry.revoke_session(sessionTwo.getPrincipal());
  assert.ok('ok' in revoked);
  const afterRevoke = await registry.me();
  assert.deepEqual(afterRevoke, { err: { unauthorized: null } });
});

test('registry verifies an EIP-191 wallet challenge and rejects misuse', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy wallet integration controller');
  const session = createIdentity('meritocracy wallet browser session');
  const attacker = createIdentity('meritocracy wallet attacker session');
  const wallet = new Wallet(
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );
  const wasm = readFileSync('.mops/.build/registry.wasm');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm,
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registry = fixture.actor;
  const admin = pic.createActor(adminIdlFactory, fixture.canisterId);
  admin.setIdentity(controller);

  const configured = await admin.configure_authorities({
    rounds_canister: [],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: ['app.meritocracy.test'],
    allowed_actions: ['login'],
  });
  assert.ok('ok' in configured);

  registry.setIdentity(session);
  const disallowedDomain = await registry.begin_ethereum_login({
    address: wallet.address,
    session_principal: session.getPrincipal(),
    requested_action: 'login',
    domain: 'evil.example',
  });
  assert.deepEqual(disallowedDomain, { err: { invalid: 'domain is not allowed' } });

  const started = await registry.begin_ethereum_login({
    address: wallet.address,
    session_principal: session.getPrincipal(),
    requested_action: 'login',
    domain: 'app.meritocracy.test',
  });
  assert.ok('ok' in started);
  const signature = getBytes(await wallet.signMessage(started.ok.message));
  const publicKey = getBytes(wallet.signingKey.publicKey);
  assert.equal(signature.length, 65);
  assert.equal(publicKey.length, 65);

  registry.setIdentity(attacker);
  const wrongCaller = await registry.complete_ethereum_login({
    challenge_id: started.ok.challenge_id,
    signature,
    public_key: publicKey,
  });
  assert.deepEqual(wrongCaller, { err: { forbidden: null } });

  registry.setIdentity(session);
  const mutatedSignature = Uint8Array.from(signature);
  mutatedSignature[0] ^= 1;
  const invalidSignature = await registry.complete_ethereum_login({
    challenge_id: started.ok.challenge_id,
    signature: mutatedSignature,
    public_key: publicKey,
  });
  assert.ok('err' in invalidSignature);
  assert.ok('invalid' in invalidSignature.err);

  const completed = await registry.complete_ethereum_login({
    challenge_id: started.ok.challenge_id,
    signature,
    public_key: publicKey,
  });
  assert.ok('ok' in completed);
  assert.equal(completed.ok.issuer.ethereum_wallet, null);
  assert.equal(completed.ok.session_principal.toText(), session.getPrincipal().toText());

  const me = await registry.me();
  assert.ok('ok' in me);
  assert.equal(me.ok.profile.user_id, completed.ok.user_id);

  const replay = await registry.complete_ethereum_login({
    challenge_id: started.ok.challenge_id,
    signature,
    public_key: publicKey,
  });
  assert.deepEqual(replay, { err: { conflict: 'challenge already consumed' } });
});

