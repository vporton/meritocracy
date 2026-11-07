import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import { test } "mo:test";
import State "../canisters/vault/State";
import Types "../canisters/vault/Types";

let vault = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let ledger = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let recipient = Principal.fromText("aaaaa-aa");
let hash = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index) }));
let otherHash = Blob.fromArray(Array.tabulate<Nat8>(32, func(index) { Nat8.fromNat(index + 1) }));
let roundAccount : Types.Account = { owner = vault; subaccount = ?hash };
let reservation : Types.Reservation = {
  round_id = 7;
  asset = { ledger; symbol = "ICP"; decimals = 8 };
  fund = hash;
  required_atoms = 1_000;
  reserved_atoms = 1_000;
  fee_budget_atoms = 10;
  accounting_deficit_atoms = 0;
  finalized_outstanding_atoms = null;
  finalized_outstanding_count = null;
  allocation_version = hash;
  transfer_count = 2;
  account = roundAccount;
};

func prepared(id : Nat64, amount : Nat) : Types.PreparedTransfer {
  {
    allocation_id = id;
    to = { owner = recipient; subaccount = null };
    amount_atoms = amount;
    memo = hash;
    created_at_time = 123;
  };
};

func expectTransfer(result : State.Result<Types.Transfer>) : Types.Transfer {
  switch (result) {
    case (#ok(value)) value;
    case (#err(error)) Debug.trap(debug_show (error));
  };
};

test(
  "configuration pause and reservations survive snapshots",
  func() {
    let store = State.Store(Types.emptyState);
    assert store.configureAuthorities(vault, [ledger]) == #ok(());
    assert store.supportsLedger(ledger);
    assert store.putReservation(reservation) == #ok(reservation);
    assert store.putReservation(reservation) == #ok(reservation);
    store.setEmergencyPause(true);
    let restored = State.Store(store.snapshot());
    assert restored.roundsAuthority() == ?vault;
    assert restored.isEmergencyPaused();
    assert restored.getReservation(7) == ?reservation;
    assert restored.prepareBatch(7, hash, [prepared(1, 10)]) == #err(#paused);
  },
);

test(
  "exact duplicate batch is idempotent and conflicting payload is rejected",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.putReservation(reservation);
    let first = store.prepareBatch(7, hash, [prepared(1, 100), prepared(2, 200)]);
    assert first == store.prepareBatch(7, hash, [prepared(1, 100), prepared(2, 200)]);
    switch (store.prepareBatch(7, hash, [prepared(1, 101), prepared(2, 200)])) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
    switch (store.prepareBatch(7, otherHash, [prepared(1, 100)])) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
  },
);

test(
  "retry preserves immutable transfer input and success debits amount plus fee once",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.putReservation(reservation);
    ignore store.prepareBatch(7, hash, [prepared(1, 100)]);
    let executing = expectTransfer(store.markExecuting(1));
    assert executing.state == #executing(1);
    let retryable = expectTransfer(store.markRetryable(1, "ledger unavailable", 10));
    assert retryable.state == #retryable_failure("ledger unavailable");
    let retry = expectTransfer(store.markExecuting(1));
    assert retry.state == #executing(2);
    assert retry.memo == hash;
    assert retry.created_at_time == 123;
    let sent = expectTransfer(store.markSent(1, 55, 10));
    assert sent.state == #sent(55);
    assert sent.fee_atoms == ?10;
    switch (store.getReservation(7)) {
      case (?value) assert value.reserved_atoms == 890;
      case null assert false;
    };
    assert store.markSent(1, 55, 10) == #ok(sent);
    switch (store.getReservation(7)) {
      case (?value) assert value.reserved_atoms == 890;
      case null assert false;
    };
  },
);

test(
  "permanent failure cannot execute again and a fee overrun cannot erase a receipt",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.putReservation({ reservation with reserved_atoms = 105 });
    ignore store.prepareBatch(7, hash, [prepared(1, 100), prepared(2, 1)]);
    ignore store.markExecuting(1);
    ignore store.markPermanent(1, "bad burn", 10);
    switch (store.markExecuting(1)) {
      case (#err(#conflict(_))) {};
      case _ assert false;
    };
    ignore store.markExecuting(2);
    let #ok(overrun) = store.markSent(2, 9, 105) else Debug.trap("fee overrun receipt");
    assert overrun.state == #sent(9) and overrun.fee_atoms == ?105;
    assert store.markSent(2, 9, 105) == #ok(overrun);
    assert store.getReservation(7) == ?{ reservation with reserved_atoms = 94 };
  },
);

test(
  "carried rollover is idempotent, conflict-safe, and debits source plus fee once",
  func() {
    let store = State.Store(Types.emptyState);
    ignore store.putReservation(reservation);
    let #ok(finalized) = store.finalizeReservation(7, 100, 1, 10) else Debug.trap("finalize reservation");
    assert finalized.reserved_atoms == 110;
    assert store.finalizeReservation(7, 100, 1, 99) == #ok(finalized);
    let rollover : Types.Rollover = {
      allocation_id = 77;
      source_round = 7;
      target_round = 8;
      to = { owner = vault; subaccount = ?otherHash };
      amount_atoms = 100;
      fee_atoms = 10;
      memo = otherHash;
      created_at_time = 999;
      state = #prepared;
    };
    assert store.prepareRollover(rollover) == #ok(rollover);
    assert store.prepareRollover(rollover) == #ok(rollover);
    assert switch (store.prepareRollover({ rollover with target_round = (9 : Nat64) })) {
      case (#err(#conflict(_))) true;
      case _ false;
    };
    let #ok(sent) = store.markRolloverSent(77, 44) else Debug.trap("rollover send");
    assert sent.state == #sent(44);
    assert store.markRolloverSent(77, 44) == #ok(sent);
    assert switch (store.getReservation(7)) {
      case (?value) value.reserved_atoms == 0 and value.accounting_deficit_atoms == 0;
      case null false;
    };
    assert store.prepareRollover(rollover) == #ok(sent);
    let poor = State.Store(Types.emptyState);
    ignore poor.putReservation({ reservation with reserved_atoms = 105 });
    assert switch (poor.prepareRollover(rollover)) {
      case (#err(#conflict(_))) true;
      case _ false;
    };
    let unfinalized = State.Store(Types.emptyState);
    ignore unfinalized.putReservation(reservation);
    assert switch (unfinalized.prepareRollover(rollover)) {
      case (#err(#conflict("source reservation must be finalized before rollover"))) true;
      case _ false;
    };
  },
);
