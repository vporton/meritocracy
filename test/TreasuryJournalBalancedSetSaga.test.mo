import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Journal "../canisters/treasury/TreasuryJournalIntent";
import Set "../canisters/treasury/TreasuryJournalBalancedSet";
import Saga "../canisters/treasury/TreasuryJournalBalancedSetSaga";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

func entry(id : Text, sequence : Nat64, direction : Journal.Direction) : Journal.Input {
  {
    logicalId = id;
    journalSequence = sequence;
    operationId = "operation:journal-set-saga";
    accountId = if (direction == #debit) "treasury:available" else "treasury:liability";
    assetId = "icrc1:ledger:TEST";
    direction;
    amountBaseUnits = 125_000;
    assetDecimals = 8;
    desiredVersion = 1;
    contentHash = hash(Nat8.fromNat(Nat64.toNat(sequence)));
  };
};

let debit = entry("treasury-journal:v1:saga-debit", 201, #debit);
let credit = entry("treasury-journal:v1:saga-credit", 202, #credit);
let input : Set.Input = { logicalId = "treasury-journal-set:v1:saga"; entries = [debit, credit] };
let prepared = switch (Saga.prepare(input)) {
  case (?state) state;
  case null { assert false; loop {} };
};

// No partial write is active, even when one exact acknowledgement arrives.
let debitSent = Saga.startWrite(prepared, 0);
// Merely sending an ingress does not authorize a resend: only a bounded
// `#absent` observation after a lost reply does.
assert Saga.retryInput(debitSent, 0) == null;
let (debitAcked, debitDecision) = Saga.reconcile(
  Saga.lostReply(debitSent, 0),
  0,
  #present({ version = debit.desiredVersion; contentHash = debit.contentHash }),
);
assert debitDecision == #acknowledge;
assert debitAcked.phase == #pending;

let creditSent = Saga.startWrite(debitAcked, 1);
let (active, creditDecision) = Saga.reconcile(
  Saga.lostReply(creditSent, 1),
  1,
  #present({ version = credit.desiredVersion; contentHash = credit.contentHash }),
);
assert creditDecision == #acknowledge;
assert active.phase == #active;
assert Saga.retryInput(active, 0) == null;

// An absent lookup permits only the already persisted posting to retry.
let retrySent = Saga.startWrite(prepared, 0);
let (retryable, retryDecision) = Saga.reconcile(Saga.lostReply(retrySent, 0), 0, #absent);
assert retryDecision == #retryIdentical;
let ?retained = Saga.retryInput(retryable, 0) else { assert false; loop {} };
assert retained == debit;
assert Saga.matchesRetained(retryable, 0, debit);
assert not Saga.matchesRetained(retryable, 0, { debit with amountBaseUnits = 125_001 });

// A changed remote tuple fails closed for the whole balanced set.
let conflictSent = Saga.startWrite(prepared, 0);
let (conflicted, conflictDecision) = Saga.reconcile(
  Saga.lostReply(conflictSent, 0),
  0,
  #present({ version = debit.desiredVersion + 1; contentHash = debit.contentHash }),
);
assert conflictDecision == #conflict;
assert conflicted.phase == #conflict;
assert Saga.startWrite(conflicted, 1) == conflicted;
assert Saga.retryInput(conflicted, 0) == null;

assert Saga.prepare({ input with entries = [debit] }) == null;
