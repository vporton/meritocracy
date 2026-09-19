import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Journal "../canisters/treasury/TreasuryJournalIntent";
import Saga "../canisters/treasury/TreasuryJournalArchiveExportSaga";
import Option "mo:base/Option";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

func entry(logicalId : Text, sequence : Nat64, direction : Journal.Direction) : Journal.Input {
  {
    logicalId;
    journalSequence = sequence;
    operationId = "payment-operation:v1:archive-export-saga";
    accountId = if (direction == #debit) "liability" else "treasury";
    assetId = "ICP";
    direction;
    amountBaseUnits = 25;
    assetDecimals = 8;
    desiredVersion = 1;
    contentHash = hash(if (sequence == 1) 1 else 2);
  };
};

let set = {
  logicalId = "treasury-journal-set:v1:archive-export-saga";
  entries = [entry("treasury-journal:v1:archive-export-saga:debit", 1, #debit), entry("treasury-journal:v1:archive-export-saga:credit", 2, #credit)];
};

let prepared = Option.unwrap(Saga.prepare(set, 1));
assert prepared.phase == #prepared;
assert Saga.prepare(set, 0) == null;
assert Saga.retryBinding(set, prepared) == null;

let started = Saga.startArchive(set, prepared);
assert started.phase == #archiveStarted;
let pending = Saga.lostReply(started);
assert pending.phase == #pending;
assert Saga.retryBinding(set, pending) == ?pending.binding;

// Missing and competing receipts cannot acknowledge the retained export.
assert Saga.reconcile(set, pending, null).phase == #pending;
assert Saga.reconcile(set, pending, ?{ pending.binding.tuple with contentHash = hash(99) }).phase == #pending;
assert Saga.reconcile(set, pending, ?pending.binding.tuple).phase == #acknowledged;

// Altered durable bytes or a reordered source set block before dispatch and
// cannot yield a retry binding.
let altered = { pending with binding = { pending.binding with bytes = Blob.fromArray([0]) } };
assert Saga.startArchive(set, altered).phase == #blocked;
assert Saga.retryBinding(set, altered) == null;
let reordered = { set with entries = [set.entries[1], set.entries[0]] };
assert Saga.reconcile(reordered, pending, ?pending.binding.tuple).phase == #blocked;
