import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory } from '../frontend/src/declarations/registry/registry.did.js';

const seed = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
const referenceHash = Buffer.alloc(32, 0xab);

function canonicalAttestation(attestation) {
  const status = 'eligible' in attestation.status ? 'eligible' : 'ineligible';
  const expiry = attestation.expires_at.length === 0 ? 'none' : attestation.expires_at[0].toString();
  return [
    'meritocracy/icp/v1/eligibility-attestation',
    `user_id=${attestation.user_id}`,
    `issuer=${attestation.issuer}`,
    `status=${status}`,
    `reference_hash=${Buffer.from(attestation.reference_hash).toString('hex')}`,
    `issued_at_ns=${attestation.issued_at}`,
    `expires_at_ns=${expiry}`,
  ].join('\n');
}

test('attestation endpoint enforces issuer caller and Ed25519 signature', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy attestation controller');
  const issuer = createIdentity('meritocracy attestation issuer');
  const impostor = createIdentity('meritocracy attestation impostor');
  const iiIdentity = createIdentity('meritocracy attestation subject');
  const session = createIdentity('meritocracy attestation session');
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
    attestation_issuers: [{
      name: 'fixture-issuer',
      caller: issuer.getPrincipal(),
      public_key: publicKey,
    }],
    allowed_domains: ['app.meritocracy.test'],
    allowed_actions: ['login'],
    oauth_site_url: '',
    oauth_providers: [],
    oauth_redirect_uris: [],
  });
  assert.ok('ok' in configured);

  registry.setIdentity(iiIdentity);
  const login = await registry.complete_internet_identity_login({
    session_principal: session.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in login);

  const unsigned = {
    user_id: login.ok.user_id,
    issuer: 'fixture-issuer',
    status: { eligible: null },
    reference_hash: referenceHash,
    issued_at: 0n,
    expires_at: [],
  };
  const signature = sign(null, Buffer.from(canonicalAttestation(unsigned)), privateKey);
  const attestation = { ...unsigned, signature };

  registry.setIdentity(impostor);
  const wrongCaller = await registry.put_attestation(attestation);
  assert.deepEqual(wrongCaller, { err: { forbidden: null } });

  registry.setIdentity(issuer);
  const mutated = Uint8Array.from(signature);
  mutated[0] ^= 1;
  const invalidSignature = await registry.put_attestation({ ...unsigned, signature: mutated });
  assert.deepEqual(invalidSignature, { err: { unauthorized: null } });

  const accepted = await registry.put_attestation(attestation);
  assert.ok('ok' in accepted);
  assert.deepEqual(accepted.ok.status, { eligible: null });
  assert.equal(accepted.ok.issuer[0], 'fixture-issuer');
  assert.deepEqual(Buffer.from(accepted.ok.reference_hash[0]), referenceHash);

  const replay = await registry.put_attestation(attestation);
  assert.deepEqual(replay, {
    err: { conflict: 'attestation is not newer than the current issuer record' },
  });
});
