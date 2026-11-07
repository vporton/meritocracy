import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Principal } from '@icp-sdk/core/principal';
import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory } from '../frontend/src/declarations/registry/registry.did.js';

const adminIdlFactory = ({ IDL }) => {
  const AppError = IDL.Variant({
    unauthorized: IDL.Null,
    forbidden: IDL.Null,
    not_found: IDL.Null,
    conflict: IDL.Text,
    invalid: IDL.Text,
    expired: IDL.Null,
    rate_limited: IDL.Record({ retry_after_ns: IDL.Nat64 }),
    paused: IDL.Null,
    transient: IDL.Text,
    internal: IDL.Text,
  });
  return IDL.Service({
    configure_authorities: IDL.Func(
      [IDL.Record({
        rounds_canister: IDL.Opt(IDL.Principal),
        session_consumers: IDL.Vec(IDL.Principal),
        attestation_issuers: IDL.Vec(IDL.Record({
          name: IDL.Text,
          caller: IDL.Principal,
          public_key: IDL.Vec(IDL.Nat8),
        })),
        allowed_domains: IDL.Vec(IDL.Text),
        allowed_actions: IDL.Vec(IDL.Text),
        oauth_site_url: IDL.Text,
        oauth_providers: IDL.Vec(IDL.Record({
          kind: IDL.Variant({ github: IDL.Null, google: IDL.Null }),
          client_id: IDL.Text,
        })),
        oauth_redirect_uris: IDL.Vec(IDL.Text),
      })],
      [IDL.Variant({ ok: IDL.Null, err: AppError })],
      [],
    ),
  });
};

const ledger = Principal.fromText('aaaaa-aa');
const route = {
  network: { icp: null },
  asset: [{ ledger, symbol: 'ICP', decimals: 8 }],
};
const subaccountUpper = '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF';
const subaccountLower = subaccountUpper.toLowerCase();

test('ICRC payout proof uses the account owner principal and snapshots a structured account', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('registry ICRC controller');
  const iiIdentity = createIdentity('registry ICRC Internet Identity');
  const sessionIdentity = createIdentity('registry ICRC session');
  const ownerIdentity = createIdentity('registry ICRC account owner');
  const wrongOwner = createIdentity('registry ICRC wrong owner');
  const roundsIdentity = createIdentity('registry ICRC rounds authority');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm: readFileSync('.mops/.build/registry.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registry = fixture.actor;
  const admin = pic.createActor(adminIdlFactory, fixture.canisterId);
  admin.setIdentity(controller);
  const configured = await admin.configure_authorities({
    rounds_canister: [roundsIdentity.getPrincipal()],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: [],
    allowed_actions: ['login'],
    oauth_site_url: '',
    oauth_providers: [],
    oauth_redirect_uris: [],
  });
  assert.ok('ok' in configured);

  registry.setIdentity(iiIdentity);
  const session = await registry.complete_internet_identity_login({
    session_principal: sessionIdentity.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in session);

  registry.setIdentity(sessionIdentity);
  const account = await registry.add_payout_account({
    route,
    address: `${ownerIdentity.getPrincipal().toText().toUpperCase()}:${subaccountUpper}`,
  });
  assert.ok('ok' in account);
  assert.equal(account.ok.normalized_address, `${ownerIdentity.getPrincipal().toText()}:${subaccountLower}`);
  assert.deepEqual(account.ok.verification, { pending: null });

  registry.setIdentity(wrongOwner);
  const rejected = await registry.complete_icrc_payout_proof(account.ok.id);
  assert.deepEqual(rejected, { err: { forbidden: null } });

  registry.setIdentity(ownerIdentity);
  const verified = await registry.complete_icrc_payout_proof(account.ok.id);
  assert.ok('ok' in verified);
  assert.deepEqual(verified.ok.verification, { verified: null });
  const replay = await registry.complete_icrc_payout_proof(account.ok.id);
  assert.ok('err' in replay && 'conflict' in replay.err);

  registry.setIdentity(sessionIdentity);
  assert.ok('ok' in await registry.set_payout_account_active(account.ok.id, true));
  assert.ok('ok' in await registry.set_default_payout_account(account.ok.id));

  registry.setIdentity(roundsIdentity);
  const snapshot = await registry.snapshot_recipient({
    user_id: session.ok.user_id,
    route,
    round_id: 44n,
  });
  assert.ok('ok' in snapshot);
  assert.equal(snapshot.ok.icrc_account.length, 1);
  assert.equal(snapshot.ok.icrc_account[0].owner.toText(), ownerIdentity.getPrincipal().toText());
  assert.equal(Buffer.from(snapshot.ok.icrc_account[0].subaccount[0]).toString('hex'), subaccountLower);

  const mismatched = await registry.snapshot_recipient({
    user_id: session.ok.user_id,
    route: { ...route, asset: [{ ledger, symbol: 'ckBTC', decimals: 8 }] },
    round_id: 45n,
  });
  assert.deepEqual(mismatched, { err: { not_found: null } });
});
