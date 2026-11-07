import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory as auditIdlFactory } from '../frontend/src/declarations/audit/audit.did.js';
import { idlFactory as roundsIdlFactory } from '../frontend/src/declarations/rounds/rounds.did.js';
import { idlFactory as vaultIdlFactory } from '../frontend/src/declarations/vault/vault.did.js';
import {
  reconcileShadow,
  signReport,
  updateEvidenceLedger,
  verifySignedReport,
} from '../scripts/icp/migration/lib.mjs';

const account = (IDL) => IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const asset = (IDL) => IDL.Record({ ledger: IDL.Principal, symbol: IDL.Text, decimals: IDL.Nat8 });
const ledgerIdlFactory = ({ IDL }) => IDL.Service({
  mint: IDL.Func([account(IDL), IDL.Nat], [], []),
  set_fee: IDL.Func([IDL.Nat], [], []),
  icrc1_balance_of: IDL.Func([account(IDL)], [IDL.Nat], ['query']),
});
const registryIdlFactory = ({ IDL }) => {
  const Asset = asset(IDL);
  const Account = account(IDL);
  return IDL.Service({
    configure: IDL.Func([IDL.Record({ rounds: IDL.Principal, session: IDL.Principal, recipient: Account, asset: Asset })], [], []),
    carried_credits: IDL.Func([], [IDL.Vec(IDL.Record({
      user_id: IDL.Nat64,
      allocation_id: IDL.Nat64,
      balance: IDL.Record({ asset: Asset, atoms: IDL.Nat, source_round: IDL.Nat64, reason: IDL.Text }),
    }))], ['query']),
  });
};

const bytes32 = (value) => Uint8Array.from({ length: 32 }, () => value);
const variantName = (value) => Object.keys(value)[0];

test('three exact PocketIC shadow rounds reconcile and a mismatch resets the evidence streak', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('stage seven shadow controller');
  const session = createIdentity('stage seven shadow session');
  const recipient = createIdentity('stage seven shadow recipient');
  const setup = async (idlFactory, wasm) => pic.setupCanister({
    idlFactory,
    wasm: readFileSync(wasm),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const ledgerFixture = await setup(ledgerIdlFactory, '.mops/.build/mock-icrc1-ledger.wasm');
  const registryFixture = await setup(registryIdlFactory, '.mops/.build/mock-registry.wasm');
  const auditFixture = await setup(auditIdlFactory, '.mops/.build/audit.wasm');
  const vaultFixture = await setup(vaultIdlFactory, '.mops/.build/vault.wasm');
  const roundsFixture = await setup(roundsIdlFactory, '.mops/.build/rounds.wasm');
  const actors = [ledgerFixture.actor, registryFixture.actor, auditFixture.actor, vaultFixture.actor, roundsFixture.actor];
  for (const actor of actors) actor.setIdentity(controller);
  const ledger = ledgerFixture.actor;
  const registry = registryFixture.actor;
  const audit = auditFixture.actor;
  const vault = vaultFixture.actor;
  const rounds = roundsFixture.actor;

  assert.ok('ok' in await rounds.configure_authorities({
    registry_canister: registryFixture.canisterId,
    vault_canister: vaultFixture.canisterId,
    audit_canister: auditFixture.canisterId,
    managers: [controller.getPrincipal()],
    dispute_resolvers: [controller.getPrincipal()],
  }));
  assert.ok('ok' in await vault.configure_authorities({ rounds_canister: roundsFixture.canisterId, supported_ledgers: [ledgerFixture.canisterId] }));
  assert.ok('ok' in await audit.configure_authorities({ appenders: [roundsFixture.canisterId] }));
  const assetId = { ledger: ledgerFixture.canisterId, symbol: 'ICP', decimals: 8 };
  await registry.configure({
    rounds: roundsFixture.canisterId,
    session: session.getPrincipal(),
    recipient: { owner: recipient.getPrincipal(), subaccount: [] },
    asset: assetId,
  });
  await ledger.set_fee(10n);

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  let evidence = { schema: 'meritocracy-reconciliation-ledger/v1', entries: [], ready_for_treasury_migration: false };
  const reports = [];
  for (let index = 0; index < 3; index += 1) {
    const amount = 100n + BigInt(index);
    const allocationId = 7_001n + BigInt(index);
    const sourceFund = bytes32(0x70 + index);
    const created = await rounds.create_draft({ asset: assetId, source_fund: sourceFund, required_atoms: amount });
    assert.ok('ok' in created);
    const roundId = created.ok.id;
    assert.ok('ok' in await rounds.put_allocation_version({
      round_id: roundId,
      expected_previous_version: [],
      allocations: [{ id: allocationId, user_id: 1n, amount_atoms: amount, evidence_hash: bytes32(0x40 + index) }],
    }));
    const roundAccount = await vault.derive_round_account({ asset: assetId, fund: sourceFund, round_id: roundId });
    await ledger.mint(roundAccount, amount + 10n);
    assert.ok('ok' in await rounds.verify_funding(roundId));
    assert.ok('ok' in await rounds.finalize(roundId));
    await pic.advanceTime(7 * 24 * 60 * 60 * 1_000 + 1);
    await pic.tick(3);

    const round = await rounds.get_round(roundId);
    const allocationPage = await rounds.list_allocations(roundId, { cursor: [], limit: 10 });
    const transfer = await vault.get_transfer(allocationId);
    const reconciliation = await rounds.reconcile(roundId);
    assert.ok('ok' in round && 'ok' in allocationPage && 'ok' in transfer && 'ok' in reconciliation);
    assert.equal(variantName(round.ok.status), 'complete');
    assert.equal(variantName(allocationPage.ok.items[0].state), 'paid');
    assert.equal(reconciliation.ok.reconciled, true);
    assert.equal(await ledger.icrc1_balance_of(roundAccount), 0n);

    const shared = {
      mappings: [{ legacy_user_id: 'legacy-1', icp_user_id: '1' }],
      eligibility: [{ legacy_user_id: 'legacy-1', status: 'eligible', reference_hash: 'aa'.repeat(32) }],
      evaluations: [{ legacy_user_id: 'legacy-1', weight_numerator: '3', weight_denominator: '2', outcome: 'accepted' }],
      allocations: [{ allocation_id: allocationId.toString(), user_id: '1', atoms: amount.toString() }],
      routes: [{ allocation_id: allocationId.toString(), network: 'icp', asset: 'ICP', normalized_address: recipient.getPrincipal().toText() }],
      carried: [],
      transfers: [{ allocation_id: allocationId.toString(), memo: Buffer.from(transfer.ok.memo).toString('hex'), block_index: transfer.ok.state.sent.toString(), fee_atoms: '10' }],
      vault: { round_id: roundId.toString(), ledger_atoms: reconciliation.ok.ledger_atoms.toString(), reserved_atoms: reconciliation.ok.reserved_atoms.toString() },
    };
    const legacy = structuredClone(shared);
    const icp = structuredClone(shared);
    const reconciliationReport = reconcileShadow(legacy, icp);
    assert.equal(reconciliationReport.counts.unexplained, 0);
    const report = {
      schema: 'meritocracy-signed-reconciliation/v1',
      // All three executions compare the same immutable export snapshot.
      export_root: 'fixture-root-shared',
      legacy_revision: 'legacy-fixture-v1',
      icp_revision: 'icp-fixture-v1',
      canisters: { rounds: roundsFixture.canisterId.toText(), vault: vaultFixture.canisterId.toText() },
      interfaces: { rounds: 'rounds-v1', vault: 'vault-v1' },
      asset: 'ICP',
      ledger: ledgerFixture.canisterId.toText(),
      round_id: roundId.toString(),
      diff_counts: reconciliationReport.counts,
      ledger_reconciled: reconciliation.ok.reconciled,
      reviewer_approved: true,
    };
    const signed = signReport(report, privateKey);
    assert.equal(verifySignedReport(signed, publicKey), true);
    evidence = updateEvidenceLedger(evidence, signed, publicKey);
    assert.equal(evidence.entries.at(-1).consecutive, index + 1);
    reports.push({ report, legacy, icp });
  }
  assert.equal(evidence.ready_for_treasury_migration, true, 'three unchanged reconciled rounds satisfy the local shadow gate');

  const mismatchedIcp = structuredClone(reports[2].icp);
  mismatchedIcp.allocations[0].atoms = '9999';
  const mismatch = reconcileShadow(reports[2].legacy, mismatchedIcp);
  assert.ok(mismatch.differences.some(({ category, kind }) => category === 'unexplained' && kind === 'allocation'));
  const mismatchReport = {
    ...reports[2].report,
    export_root: 'fixture-root-mismatch',
    round_id: 'mismatch',
    diff_counts: mismatch.counts,
    ledger_reconciled: true,
    reviewer_approved: true,
  };
  evidence = updateEvidenceLedger(evidence, signReport(mismatchReport, privateKey), publicKey);
  assert.equal(evidence.entries.at(-1).consecutive, 0);
  assert.equal(evidence.ready_for_treasury_migration, false);
});
