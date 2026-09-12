import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/treasury/PaymentOperationArchiveRecovery";
import Intent "../canisters/treasury/PaymentOperationIntent";
import Saga "../canisters/treasury/PaymentOperationSaga";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Intent.Input = {
  logicalId = "payment-operation:v1:synthetic-saga-44";
  operationId = "op:synthetic-saga-44";
  obligationId = "obligation:synthetic-saga-44";
  assetId = "icrc1:ledger:TEST";
  amountBaseUnits = 125_000;
  assetDecimals = 8;
  destinationHash = hash(4);
  desiredVersion = 1;
  contentHash = hash(9);
};

let prepared = switch (Saga.prepare(input)) {
  case (?value) value;
  case null { assert false; loop {} };
};

// A payment operation cannot be archived/activated before the exact storage
// tuple is acknowledged, including after an ambiguous storage reply.
let (pendingArchive, pendingDecision) = Saga.beginArchive(Saga.startStorageWrite(prepared));
assert pendingDecision == #remainPending;
assert pendingArchive.archive == null;
assert not pendingArchive.active;

let (acknowledged, storageDecision) = Saga.reconcileStorage(
  Saga.startStorageWrite(prepared),
  #present({ version = input.desiredVersion; contentHash = input.contentHash }),
);
assert storageDecision == #acknowledge;

let (archiving, archiveStart) = Saga.beginArchive(acknowledged);
assert archiveStart == #remainPending;
assert not archiving.active;
let ?tuple = archiving.archive else { assert false; loop {} };

let (stillPending, missingReceipt) = Saga.reconcileArchive(archiving, null);
assert missingReceipt == #remainPending;
assert not stillPending.active;
let (active, exactReceipt) = Saga.reconcileArchive(stillPending, ?tuple);
assert exactReceipt == #acknowledge;
assert active.active;

let changed : Archive.ArchiveTuple = { tuple with contentHash = hash(10) };
let (mismatched, mismatchDecision) = Saga.reconcileArchive(archiving, ?changed);
assert mismatchDecision == #remainPending;
assert not mismatched.active;

let (conflicted, conflictDecision) = Saga.reconcileStorage(
  Saga.startStorageWrite(prepared),
  #present({ version = input.desiredVersion + 1; contentHash = input.contentHash }),
);
assert conflictDecision == #conflict;
let (_, blockedArchive) = Saga.beginArchive(conflicted);
assert blockedArchive == #remainPending;
