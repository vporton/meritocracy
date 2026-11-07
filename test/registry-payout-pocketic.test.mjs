import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Principal } from '@icp-sdk/core/principal';
import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';
import { Wallet, concat, getBytes } from 'ethers';

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

const ethereumRoute = (asset = []) => ({ network: { ethereum: null }, asset });
const wallet = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
const legacyWallet = new Wallet('0x1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

async function issueSession(registry, iiIdentity, sessionIdentity) {
  registry.setIdentity(iiIdentity);
  const result = await registry.complete_internet_identity_login({
    session_principal: sessionIdentity.getPrincipal(),
    requested_action: 'login',
  });
  assert.ok('ok' in result);
  return result.ok;
}

async function proveEthereumAccount(registry, sessionIdentity, accountId) {
  registry.setIdentity(sessionIdentity);
  const challenge = await registry.begin_payout_proof(accountId);
  assert.ok('ok' in challenge);
  const signature = await wallet.signMessage(challenge.ok.message);
  const proof = getBytes(concat([signature, wallet.signingKey.publicKey]));
  assert.equal(proof.length, 130);
  const completed = await registry.complete_payout_proof(accountId, proof);
  assert.ok('ok' in completed);
  assert.deepEqual(completed.ok.verification, { verified: null });
  return { challenge: challenge.ok, proof, account: completed.ok };
}

test('payout proofs enforce route conflicts, independent defaults, replay, and revocation', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy payout integration controller');
  const iiOne = createIdentity('meritocracy payout II user one');
  const iiTwo = createIdentity('meritocracy payout II user two');
  const sessionOne = createIdentity('meritocracy payout session one');
  const sessionTwo = createIdentity('meritocracy payout session two');
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
    rounds_canister: [],
    session_consumers: [],
    attestation_issuers: [],
    allowed_domains: ['app.meritocracy.test'],
    allowed_actions: ['login'],
    oauth_site_url: '',
    oauth_providers: [],
    oauth_redirect_uris: [],
  });
  assert.ok('ok' in configured);

  const userOne = await issueSession(registry, iiOne, sessionOne);
  await issueSession(registry, iiTwo, sessionTwo);

  registry.setIdentity(sessionOne);
  const unauthorizedImport = await registry.import_legacy_payout_account(userOne.user_id, {
    route: ethereumRoute(),
    address: legacyWallet.address,
  });
  assert.deepEqual(unauthorizedImport, { err: { forbidden: null } });

  registry.setIdentity(controller);
  const legacyAccount = await registry.import_legacy_payout_account(userOne.user_id, {
    route: ethereumRoute(),
    address: legacyWallet.address,
  });
  assert.ok('ok' in legacyAccount);
  assert.deepEqual(legacyAccount.ok.verification, { legacy_imported: null });
  assert.equal(legacyAccount.ok.active, false);

  registry.setIdentity(sessionOne);
  const legacyActivation = await registry.set_payout_account_active(legacyAccount.ok.id, true);
  assert.deepEqual(legacyActivation, { err: { forbidden: null } });

  registry.setIdentity(sessionOne);
  const baseAccount = await registry.add_payout_account({
    route: ethereumRoute(),
    address: wallet.address,
  });
  assert.ok('ok' in baseAccount);
  assert.equal(baseAccount.ok.normalized_address, wallet.address.toLowerCase());
  assert.deepEqual(baseAccount.ok.verification, { pending: null });

  registry.setIdentity(sessionTwo);
  const conflict = await registry.add_payout_account({
    route: ethereumRoute(),
    address: wallet.address.toUpperCase().replace('0X', '0x'),
  });
  assert.ok('err' in conflict && 'conflict' in conflict.err);

  const asset = [{
    ledger: Principal.fromText('aaaaa-aa'),
    symbol: 'ckETH',
    decimals: 18,
  }];
  registry.setIdentity(sessionOne);
  const assetAccount = await registry.add_payout_account({
    route: ethereumRoute(asset),
    address: wallet.address,
  });
  assert.ok('ok' in assetAccount);

  const baseProof = await proveEthereumAccount(registry, sessionOne, baseAccount.ok.id);
  const assetProof = await proveEthereumAccount(registry, sessionOne, assetAccount.ok.id);

  registry.setIdentity(sessionOne);
  const baseActive = await registry.set_payout_account_active(baseAccount.ok.id, true);
  assert.ok('ok' in baseActive);
  const baseDefault = await registry.set_default_payout_account(baseAccount.ok.id);
  assert.ok('ok' in baseDefault && baseDefault.ok.default_for_route);

  const assetActive = await registry.set_payout_account_active(assetAccount.ok.id, true);
  assert.ok('ok' in assetActive);
  const assetDefault = await registry.set_default_payout_account(assetAccount.ok.id);
  assert.ok('ok' in assetDefault && assetDefault.ok.default_for_route);

  const accounts = await registry.list_my_payout_accounts();
  assert.ok('ok' in accounts);
  const baseReadback = accounts.ok.find((account) => account.id === baseAccount.ok.id);
  const assetReadback = accounts.ok.find((account) => account.id === assetAccount.ok.id);
  assert.equal(baseReadback?.default_for_route, true);
  assert.equal(assetReadback?.default_for_route, true);

  const replay = await registry.complete_payout_proof(baseAccount.ok.id, baseProof.proof);
  assert.deepEqual(replay, { err: { not_found: null } });

  const revoked = await registry.revoke_payout_account(baseAccount.ok.id);
  assert.ok('ok' in revoked);
  assert.deepEqual(revoked.ok.verification, { revoked: null });
  assert.equal(revoked.ok.active, false);
  assert.equal(revoked.ok.default_for_route, false);

  const finalAccounts = await registry.list_my_payout_accounts();
  assert.ok('ok' in finalAccounts);
  const unaffected = finalAccounts.ok.find((account) => account.id === assetProof.account.id);
  assert.equal(unaffected?.active, true);
  assert.equal(unaffected?.default_for_route, true);
});
