import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Principal } from '@icp-sdk/core/principal';
import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory } from '../frontend/src/declarations/registry/registry.did.js';

test('legacy profile mapping is controller-only, replay-safe, and imports payouts inactive', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('registry legacy import controller');
  const attacker = createIdentity('registry legacy import attacker');
  const session = createIdentity('registry legacy import normal session');
  const fixture = await pic.setupCanister({
    idlFactory,
    wasm: readFileSync('.mops/.build/registry.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registry = fixture.actor;
  registry.setIdentity(controller);
  assert.ok('ok' in await registry.configure_authorities({
    rounds_canister: [],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: [],
    allowed_actions: ['login'],
    oauth_site_url: '',
    oauth_providers: [],
    oauth_redirect_uris: [],
  }));
  const input = {
    source_namespace: 'postgres-v1',
    legacy_user_id: '42',
    name: ['Legacy Alice'],
    created_at: 1_600_000_000_000_000_000n,
    status: { active: null },
  };

  registry.setIdentity(attacker);
  assert.deepEqual(await registry.import_legacy_profile(input), { err: { forbidden: null } });

  registry.setIdentity(controller);
  const imported = await registry.import_legacy_profile(input);
  assert.ok('ok' in imported);
  assert.equal(imported.ok.user_id, 1n);
  assert.deepEqual(await registry.import_legacy_profile(input), imported);
  const conflict = await registry.import_legacy_profile({ ...input, name: ['Changed'] });
  assert.ok('err' in conflict && 'conflict' in conflict.err);

  assert.deepEqual(await registry.get_legacy_user_mapping('postgres-v1', '42'), imported);
  const mappings = await registry.list_legacy_user_mappings({ cursor: [], limit: 10 });
  assert.ok('ok' in mappings);
  assert.deepEqual(mappings.ok.items, [imported.ok]);

  const ledger = Principal.fromText('aaaaa-aa');
  const payout = await registry.import_legacy_payout_account(imported.ok.user_id, {
    route: { network: { icp: null }, asset: [{ ledger, symbol: 'ICP', decimals: 8 }] },
    address: controller.getPrincipal().toText(),
  });
  assert.ok('ok' in payout);
  assert.deepEqual(payout.ok.verification, { legacy_imported: null });
  assert.equal(payout.ok.active, false);
  assert.equal(payout.ok.default_for_route, false);

  registry.setIdentity(attacker);
  const normal = await registry.complete_internet_identity_login({
    session_principal: session.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in normal);
  assert.equal(normal.ok.user_id, 2n, 'normal user IDs must not collide with imported users');
});
