import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory as auditIdlFactory } from '../frontend/src/declarations/audit/audit.did.js';
import { idlFactory as roundsIdlFactory } from '../frontend/src/declarations/rounds/rounds.did.js';
import { idlFactory as vaultIdlFactory } from '../frontend/src/declarations/vault/vault.did.js';

const account = (IDL) => IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const asset = (IDL) => IDL.Record({ ledger: IDL.Principal, symbol: IDL.Text, decimals: IDL.Nat8 });

const ledgerIdlFactory = ({ IDL }) => IDL.Service({
  mint: IDL.Func([account(IDL), IDL.Nat], [], []),
  set_fee: IDL.Func([IDL.Nat], [], []),
  fail_next_temporary: IDL.Func([], [], []),
  transfer_call_count: IDL.Func([], [IDL.Nat], ['query']),
  successful_transfer_count: IDL.Func([], [IDL.Nat], ['query']),
  icrc1_balance_of: IDL.Func([account(IDL)], [IDL.Nat], ['query']),
});

const registryIdlFactory = ({ IDL }) => {
  const Asset = asset(IDL);
  const Account = account(IDL);
  const CarriedBalance = IDL.Record({
    asset: Asset,
    atoms: IDL.Nat,
    source_round: IDL.Nat64,
    reason: IDL.Text,
  });
  const Credit = IDL.Record({ user_id: IDL.Nat64, balance: CarriedBalance, allocation_id: IDL.Nat64 });
  return IDL.Service({
    configure: IDL.Func([IDL.Record({
      rounds: IDL.Principal,
      session: IDL.Principal,
      recipient: Account,
      asset: Asset,
    })], [], []),
    carried_credits: IDL.Func([], [IDL.Vec(Credit)], ['query']),
    fail_next_consume: IDL.Func([], [], []),
  });
};

const bytes32 = (value) => Uint8Array.from({ length: 32 }, () => value);
const variantName = (value) => Object.keys(value)[0];

test('round closes automatically with a frozen dispute, retry-safe payment, and carried balance', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('rounds stage four controller');
  const session = createIdentity('rounds stage four user session');
  const recipient = createIdentity('rounds stage four direct recipient');

  const ledgerFixture = await pic.setupCanister({
    idlFactory: ledgerIdlFactory,
    wasm: readFileSync('.mops/.build/mock-icrc1-ledger.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const registryFixture = await pic.setupCanister({
    idlFactory: registryIdlFactory,
    wasm: readFileSync('.mops/.build/mock-registry.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const auditFixture = await pic.setupCanister({
    idlFactory: auditIdlFactory,
    wasm: readFileSync('.mops/.build/audit.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const vaultFixture = await pic.setupCanister({
    idlFactory: vaultIdlFactory,
    wasm: readFileSync('.mops/.build/vault.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const roundsFixture = await pic.setupCanister({
    idlFactory: roundsIdlFactory,
    wasm: readFileSync('.mops/.build/rounds.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });

  const ledger = ledgerFixture.actor;
  const registry = registryFixture.actor;
  const audit = auditFixture.actor;
  const vault = vaultFixture.actor;
  const rounds = roundsFixture.actor;
  for (const actor of [ledger, registry, audit, vault, rounds]) actor.setIdentity(controller);

  const configured = await rounds.configure_authorities({
    registry_canister: registryFixture.canisterId,
    vault_canister: vaultFixture.canisterId,
    audit_canister: auditFixture.canisterId,
    managers: [controller.getPrincipal()],
    dispute_resolvers: [controller.getPrincipal()],
  });
  assert.ok('ok' in configured);
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

  const created = await rounds.create_draft({
    asset: assetId,
    source_fund: bytes32(0x31),
    required_atoms: 800n,
  });
  assert.ok('ok' in created);
  assert.equal(variantName(created.ok.status), 'draft');
  const roundId = created.ok.id;

  const allocationVersion = await rounds.put_allocation_version({
    round_id: roundId,
    expected_previous_version: [],
    allocations: [
      { id: 101n, user_id: 1n, amount_atoms: 300n, evidence_hash: bytes32(0x41) },
      { id: 102n, user_id: 1n, amount_atoms: 200n, evidence_hash: bytes32(0x42) },
      { id: 103n, user_id: 2n, amount_atoms: 300n, evidence_hash: bytes32(0x43) },
    ],
  });
  assert.ok('ok' in allocationVersion);

  const roundAccount = await vault.derive_round_account({
    asset: assetId,
    fund: bytes32(0x31),
    round_id: roundId,
  });
  await ledger.mint(roundAccount, 1_000n);
  const funded = await rounds.verify_funding(roundId);
  assert.ok('ok' in funded);
  assert.equal(variantName(funded.ok.status), 'funded');

  const finalized = await rounds.finalize(roundId);
  assert.ok('ok' in finalized);
  assert.equal(variantName(finalized.ok.status), 'disputing');
  assert.equal(finalized.ok.dispute_ends_at.length, 1);

  rounds.setIdentity(session);
  const dispute = await rounds.file_dispute({
    round_id: roundId,
    allocation_id: 102n,
    evidence_hash: bytes32(0x51),
    reason_code: 'recipient-challenged',
  });
  assert.ok('ok' in dispute);

  rounds.setIdentity(controller);
  const resolved = await rounds.resolve_dispute({ dispute_id: dispute.ok.id, resolution: { uphold: null } });
  assert.ok('ok' in resolved);
  const beforeExecution = await rounds.list_allocations(roundId, { cursor: [], limit: 10 });
  assert.ok('ok' in beforeExecution);
  assert.deepEqual(beforeExecution.ok.items.map(({ state }) => variantName(state)), ['pending', 'frozen', 'carried']);

  await ledger.fail_next_temporary();
  await pic.advanceTime(7 * 24 * 60 * 60 * 1_000 + 1);
  await pic.tick(3);

  const afterTimer = await rounds.get_round(roundId);
  assert.ok('ok' in afterTimer);
  assert.equal(variantName(afterTimer.ok.status), 'executing');
  assert.equal(await ledger.transfer_call_count(), 1n, 'deadline timer must attempt the direct transfer');
  assert.equal(await ledger.successful_transfer_count(), 0n);
  const recipientAccount = { owner: recipient.getPrincipal(), subaccount: [] };
  assert.equal(await ledger.icrc1_balance_of(recipientAccount), 0n, 'frozen allocation must never be paid');

  const retried = await rounds.retry_execution(roundId);
  assert.ok('ok' in retried);
  assert.equal(retried.ok.sent, 1);
  assert.equal(await ledger.successful_transfer_count(), 1n);
  assert.equal(await ledger.icrc1_balance_of(recipientAccount), 300n, 'only the non-disputed allocation is payable');
  assert.equal(await ledger.icrc1_balance_of(roundAccount), 690n);
  const paidTransfer = await vault.get_transfer(101n);
  assert.ok('ok' in paidTransfer);
  assert.notEqual(paidTransfer.ok.created_at_time, 1_700_000_000_000_000_000n, 'execution timestamp must not be captured at finalization');

  const complete = await rounds.get_round(roundId);
  assert.ok('ok' in complete);
  assert.equal(variantName(complete.ok.status), 'complete');
  const credits = await registry.carried_credits();
  assert.equal(credits.length, 1);
  assert.equal(credits[0].allocation_id, 103n);
  assert.equal(credits[0].balance.atoms, 300n);

  const callsAtCompletion = await ledger.transfer_call_count();
  const duplicate = await rounds.execute_due(roundId);
  assert.ok('ok' in duplicate, 'duplicate deadline delivery must be idempotent');
  assert.equal(await ledger.transfer_call_count(), callsAtCompletion);
  assert.equal(await ledger.successful_transfer_count(), 1n);

  const reconciliation = await rounds.reconcile(roundId);
  assert.ok('ok' in reconciliation);
  assert.equal(reconciliation.ok.reconciled, true);

  // A transfer that cannot pay its ledger fee is permanently failed by Vault
  // and must become a carried balance instead of blocking round completion.
  const permanentDraft = await rounds.create_draft({
    asset: assetId,
    source_fund: bytes32(0x61),
    required_atoms: 100n,
  });
  assert.ok('ok' in permanentDraft);
  const permanentRoundId = permanentDraft.ok.id;
  assert.ok('ok' in await rounds.put_allocation_version({
    round_id: permanentRoundId,
    expected_previous_version: [],
    allocations: [
      { id: 201n, user_id: 1n, amount_atoms: 100n, evidence_hash: bytes32(0x62) },
    ],
  }));
  const permanentAccount = await vault.derive_round_account({
    asset: assetId,
    fund: bytes32(0x61),
    round_id: permanentRoundId,
  });
  await ledger.mint(permanentAccount, 110n);
  assert.ok('ok' in await rounds.verify_funding(permanentRoundId));
  assert.ok('ok' in await rounds.finalize(permanentRoundId));
  await ledger.set_fee(20n);
  await pic.advanceTime(7 * 24 * 60 * 60 * 1_000 + 1);
  await pic.tick(3);
  const awaitingContingency = await rounds.get_round(permanentRoundId);
  assert.ok('ok' in awaitingContingency);
  assert.equal(variantName(awaitingContingency.ok.status), 'executing', 'close waits until the carried claim has a current-fee contingency');
  const racingTarget = await rounds.create_draft({ asset: assetId, source_fund: bytes32(0x71), required_atoms: 100n });
  assert.ok('ok' in racingTarget);
  assert.ok('ok' in await rounds.put_allocation_version({
    round_id: racingTarget.ok.id,
    expected_previous_version: [],
    allocations: [{ id: 202n, user_id: 1n, amount_atoms: 100n, evidence_hash: bytes32(0x72) }],
  }));
  const callsBeforeRejectedRollover = await ledger.transfer_call_count();
  const prematureRollover = await rounds.rollover_carried({ source_allocation_id: 201n, target_round: racingTarget.ok.id, target_allocation_id: 202n });
  assert.ok('err' in prematureRollover && 'conflict' in prematureRollover.err);
  assert.equal(await ledger.transfer_call_count(), callsBeforeRejectedRollover, 'rollover cannot interleave with source close');
  await ledger.mint(permanentAccount, 10n);
  assert.ok('ok' in await rounds.execute_due(permanentRoundId));
  const permanentComplete = await rounds.get_round(permanentRoundId);
  assert.ok('ok' in permanentComplete);
  assert.equal(variantName(permanentComplete.ok.status), 'complete');
  const allCredits = await registry.carried_credits();
  assert.equal(allCredits.length, 2);
  assert.deepEqual(allCredits.map(({ allocation_id }) => allocation_id), [103n, 201n]);
  await ledger.set_fee(10n);

  const report = await audit.report_round(roundId);
  assert.ok('ok' in report);
  assert.ok(report.ok.event_count >= 2n, 'dispute lifecycle must be durably audited');
  const settledFrozen = await rounds.settle_frozen_to_carried({ dispute_id: dispute.ok.id, reason: 'governance settlement' });
  assert.ok('ok' in settledFrozen);
  assert.equal(variantName(settledFrozen.ok.state), 'carried', 'upheld frozen funds require explicit resolver settlement');

  const targetDraft = await rounds.create_draft({ asset: assetId, source_fund: bytes32(0x32), required_atoms: 300n });
  assert.ok('ok' in targetDraft);
  const targetRoundId = targetDraft.ok.id;
  assert.ok('ok' in await rounds.put_allocation_version({
    round_id: targetRoundId, expected_previous_version: [],
    allocations: [{ id: 301n, user_id: 2n, amount_atoms: 300n, evidence_hash: bytes32(0x61) }],
  }));
  await registry.fail_next_consume();
  const partial = await rounds.rollover_carried({ source_allocation_id: 103n, target_round: targetRoundId, target_allocation_id: 301n });
  assert.ok('err' in partial && 'transient' in partial.err, 'ledger receipt and binding survive a transient claim-consume failure');
  const targetAccount = await vault.derive_round_account({ asset: assetId, fund: bytes32(0x32), round_id: targetRoundId });
  assert.equal(await ledger.icrc1_balance_of(targetAccount), 300n);
  const rolloverCalls = await ledger.transfer_call_count();
  await ledger.mint(targetAccount, 10n);
  assert.ok('ok' in await rounds.verify_funding(targetRoundId), 'target may become funded before partial rollover replay');
  const replayedRollover = await rounds.rollover_carried({ source_allocation_id: 103n, target_round: targetRoundId, target_allocation_id: 301n });
  assert.ok('ok' in replayedRollover, `rollover replay failed: ${JSON.stringify(replayedRollover, (_key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
  assert.equal(await ledger.transfer_call_count(), rolloverCalls, 'rollover replay must not transfer twice');
});
