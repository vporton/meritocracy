import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PocketIc, PocketIcServer, createIdentity } from '@dfinity/pic';

import { idlFactory as vaultIdlFactory } from '../frontend/src/declarations/vault/vault.did.js';

const appError = (IDL) => IDL.Variant({
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

const account = (IDL) => IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const asset = (IDL) => IDL.Record({ ledger: IDL.Principal, symbol: IDL.Text, decimals: IDL.Nat8 });
const preparedTransfer = (IDL) => IDL.Record({
  allocation_id: IDL.Nat64,
  to: account(IDL),
  amount_atoms: IDL.Nat,
  memo: IDL.Vec(IDL.Nat8),
  created_at_time: IDL.Nat64,
});
const transfer = (IDL) => IDL.Record({
  allocation_id: IDL.Nat64,
  to: account(IDL),
  amount_atoms: IDL.Nat,
  fee_atoms: IDL.Opt(IDL.Nat),
  memo: IDL.Vec(IDL.Nat8),
  created_at_time: IDL.Nat64,
  state: IDL.Variant({
    prepared: IDL.Null,
    executing: IDL.Nat32,
    sent: IDL.Nat,
    retryable_failure: IDL.Text,
    permanent_failure: IDL.Text,
  }),
});
const reservation = (IDL) => IDL.Record({
  round_id: IDL.Nat64,
  asset: asset(IDL),
  fund: IDL.Vec(IDL.Nat8),
  required_atoms: IDL.Nat,
  reserved_atoms: IDL.Nat,
  fee_budget_atoms: IDL.Nat,
  accounting_deficit_atoms: IDL.Nat,
  finalized_outstanding_atoms: IDL.Opt(IDL.Nat),
  finalized_outstanding_count: IDL.Opt(IDL.Nat32),
  allocation_version: IDL.Vec(IDL.Nat8),
  transfer_count: IDL.Nat32,
  account: account(IDL),
});

const ledgerIdlFactory = ({ IDL }) => IDL.Service({
  mint: IDL.Func([account(IDL), IDL.Nat], [], []),
  set_fee: IDL.Func([IDL.Nat], [], []),
  change_fee_on_next_transfer: IDL.Func([IDL.Nat], [], []),
  fail_next_temporary: IDL.Func([], [], []),
  transfer_call_count: IDL.Func([], [IDL.Nat], ['query']),
  successful_transfer_count: IDL.Func([], [IDL.Nat], ['query']),
  icrc1_balance_of: IDL.Func([account(IDL)], [IDL.Nat], ['query']),
});

const roundsIdlFactory = ({ IDL }) => {
  const Error = appError(IDL);
  const Reservation = reservation(IDL);
  const Batch = IDL.Record({ round_id: IDL.Nat64, transfers: IDL.Vec(transfer(IDL)) });
  return IDL.Service({
    configure_vault: IDL.Func([IDL.Principal], [], []),
    reserve_round: IDL.Func([IDL.Record({
      round_id: IDL.Nat64,
      asset: asset(IDL),
      fund: IDL.Vec(IDL.Nat8),
      required_atoms: IDL.Nat,
      allocation_version: IDL.Vec(IDL.Nat8),
      transfer_count: IDL.Nat32,
    })], [IDL.Variant({ ok: Reservation, err: Error })], []),
    execute_batch: IDL.Func([IDL.Record({
      round_id: IDL.Nat64,
      allocation_version: IDL.Vec(IDL.Nat8),
      transfers: IDL.Vec(preparedTransfer(IDL)),
    })], [IDL.Variant({ ok: Batch, err: Error })], []),
    close_round: IDL.Func([IDL.Record({ round_id: IDL.Nat64, outstanding_atoms: IDL.Nat, outstanding_count: IDL.Nat32 })], [IDL.Variant({ ok: Reservation, err: Error })], []),
  });
};

const bytes32 = (value) => Uint8Array.from({ length: 32 }, () => value);
const stateName = (value) => Object.keys(value)[0];

test('vault executes each allocation once, retries safely, tracks current fees, and reconciles', async (context) => {
  const server = await PocketIcServer.start();
  const pic = await PocketIc.create(server.getUrl());
  context.after(async () => {
    await pic.tearDown();
    await server.stop();
  });

  const controller = createIdentity('meritocracy vault controller');
  const recipientOne = createIdentity('meritocracy vault recipient one');
  const recipientTwo = createIdentity('meritocracy vault recipient two');

  const ledgerFixture = await pic.setupCanister({
    idlFactory: ledgerIdlFactory,
    wasm: readFileSync('.mops/.build/mock-icrc1-ledger.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const roundsFixture = await pic.setupCanister({
    idlFactory: roundsIdlFactory,
    wasm: readFileSync('.mops/.build/mock-rounds.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });
  const vaultFixture = await pic.setupCanister({
    idlFactory: vaultIdlFactory,
    wasm: readFileSync('.mops/.build/vault.wasm'),
    sender: controller.getPrincipal(),
    controllers: [controller.getPrincipal()],
  });

  const vault = vaultFixture.actor;
  const ledger = ledgerFixture.actor;
  const rounds = roundsFixture.actor;
  vault.setIdentity(controller);
  ledger.setIdentity(controller);
  rounds.setIdentity(controller);

  assert.ok('ok' in await vault.configure_authorities({ rounds_canister: roundsFixture.canisterId, supported_ledgers: [ledgerFixture.canisterId] }));
  await rounds.configure_vault(vaultFixture.canisterId);
  await ledger.set_fee(10n);

  const assetId = { ledger: ledgerFixture.canisterId, symbol: 'ICP', decimals: 8 };
  const fund = bytes32(0x31);
  const version = bytes32(0x41);
  const roundId = 17n;
  const roundAccount = await vault.derive_round_account({ asset: assetId, fund, round_id: roundId });
  assert.equal(roundAccount.owner.toText(), vaultFixture.canisterId.toText());
  assert.equal(roundAccount.subaccount.length, 1);
  assert.equal(roundAccount.subaccount[0].length, 32);
  await ledger.mint(roundAccount, 920n);

  const directReservation = await vault.reserve_round({
    round_id: roundId, asset: assetId, fund, required_atoms: 900n, allocation_version: version, transfer_count: 2,
  });
  assert.deepEqual(directReservation, { err: { forbidden: null } });

  const reserved = await rounds.reserve_round({
    round_id: roundId, asset: assetId, fund, required_atoms: 900n, allocation_version: version, transfer_count: 2,
  });
  assert.ok('ok' in reserved);
  assert.equal(reserved.ok.reserved_atoms, 920n);
  await ledger.mint(roundAccount, 80n); // unsolicited physical excess must not enlarge authorized obligations
  assert.deepEqual(await rounds.reserve_round({
    round_id: roundId, asset: assetId, fund, required_atoms: 900n, allocation_version: version, transfer_count: 2,
  }), reserved, 'exact reservation replay must not depend on a later fee or balance call');
  const unsupported = await rounds.reserve_round({
    round_id: 99n,
    asset: { ...assetId, ledger: recipientOne.getPrincipal() },
    fund,
    required_atoms: 1n,
    allocation_version: version,
    transfer_count: 1,
  });
  assert.ok('err' in unsupported && 'invalid' in unsupported.err, 'unlisted ledgers must fail before any ledger await');
  const underfundedRound = 18n;
  const underfundedAccount = await vault.derive_round_account({ asset: assetId, fund, round_id: underfundedRound });
  await ledger.mint(underfundedAccount, 900n);
  const underfunded = await rounds.reserve_round({ round_id: underfundedRound, asset: assetId, fund, required_atoms: 900n, allocation_version: version, transfer_count: 2 });
  assert.ok('err' in underfunded && 'invalid' in underfunded.err, 'principal-only funding must fail before finalization');

  const transfers = [
    {
      allocation_id: 101n,
      to: { owner: recipientOne.getPrincipal(), subaccount: [] },
      amount_atoms: 100n,
      memo: bytes32(0x51),
      created_at_time: 1_700_000_000_000_000_000n,
    },
    {
      allocation_id: 102n,
      to: { owner: recipientTwo.getPrincipal(), subaccount: [] },
      amount_atoms: 200n,
      memo: bytes32(0x52),
      created_at_time: 1_700_000_000_000_000_001n,
    },
  ];
  const batchInput = { round_id: roundId, allocation_version: version, transfers };

  const unauthorized = await vault.execute_batch(batchInput);
  assert.deepEqual(unauthorized, { err: { forbidden: null } });

  await ledger.fail_next_temporary();
  const first = await rounds.execute_batch(batchInput);
  assert.ok('ok' in first);
  assert.equal(stateName(first.ok.transfers[0].state), 'retryable_failure');
  assert.equal(stateName(first.ok.transfers[1].state), 'sent');
  assert.equal(await ledger.successful_transfer_count(), 1n);

  await ledger.change_fee_on_next_transfer(30n);
  const retry = await rounds.execute_batch(batchInput);
  assert.ok('ok' in retry);
  assert.deepEqual(retry.ok.transfers.map(({ state }) => stateName(state)), ['sent', 'sent']);
  assert.equal(retry.ok.transfers[0].fee_atoms[0], 30n);
  assert.equal(retry.ok.transfers[1].fee_atoms[0], 10n);
  assert.equal(await ledger.successful_transfer_count(), 2n);
  const callsAfterSuccess = await ledger.transfer_call_count();
  assert.equal(callsAfterSuccess, 4n, 'temporary failure and BadFee each require one safe retry');

  const duplicate = await rounds.execute_batch(batchInput);
  assert.ok('ok' in duplicate);
  assert.equal(await ledger.transfer_call_count(), callsAfterSuccess);
  assert.equal(await ledger.successful_transfer_count(), 2n);

  assert.equal(await ledger.icrc1_balance_of(roundAccount), 660n);
  await ledger.mint(roundAccount, 1n);
  const reconciliation = await vault.reconcile_round(roundId);
  assert.ok('ok' in reconciliation);
  assert.equal(reconciliation.ok.ledger_atoms, 661n);
  assert.equal(reconciliation.ok.reserved_atoms, 600n);
  assert.equal(reconciliation.ok.excess_atoms, 61n);
  assert.equal(reconciliation.ok.deficit_atoms, 0n);
  assert.equal(reconciliation.ok.reconciled, true);

  const closed = await rounds.close_round({ round_id: roundId, outstanding_atoms: 0n, outstanding_count: 0 });
  assert.ok('ok' in closed);
  assert.equal(closed.ok.reserved_atoms, 0n);
  assert.deepEqual(await rounds.close_round({ round_id: roundId, outstanding_atoms: 0n, outstanding_count: 0 }), closed);
  const afterClose = await vault.reconcile_round(roundId);
  assert.ok('ok' in afterClose);
  assert.equal(afterClose.ok.reserved_atoms, 0n);
  assert.equal(afterClose.ok.excess_atoms, 661n, 'paid-only fee residual and unsolicited funds are governed excess');

  assert.ok('ok' in await vault.set_emergency_pause(true));
  const paused = await rounds.execute_batch(batchInput);
  assert.deepEqual(paused, { err: { paused: null } });
  assert.equal(await ledger.transfer_call_count(), callsAfterSuccess);
  assert.ok('ok' in await vault.set_emergency_pause(false));
});
