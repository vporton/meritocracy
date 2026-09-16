import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Intent "../canisters/treasury/TreasuryJournalIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Intent.Input = {
  logicalId = "treasury-journal:v1:synthetic-44";
  journalSequence = 44;
  operationId = "op:synthetic-44";
  accountId = "treasury:available";
  assetId = "icrc1:ledger:TEST";
  direction = #debit;
  amountBaseUnits = 125_000;
  assetDecimals = 8;
  desiredVersion = 1;
  contentHash = hash(9);
};

let prepared = switch (Intent.prepare(input)) {
  case (?value) value;
  case null { assert false; loop {} };
};
assert prepared.phase == #prepared;

let recovering = Intent.lostReply(Intent.startRemoteWrite(prepared));
let (acknowledged, acknowledgement) = Intent.reconcile(
  recovering,
  #present({ version = input.desiredVersion; contentHash = input.contentHash }),
);
assert acknowledgement == #acknowledge;
assert acknowledged.phase == #acknowledged;

let (retry, retryDecision) = Intent.reconcile(recovering, #absent);
assert retryDecision == #retryIdentical;
assert retry.phase == #remoteWriteStarted;
assert retry.input == input;

let (conflict, conflictDecision) = Intent.reconcile(
  recovering,
  #present({ version = 2; contentHash = input.contentHash }),
);
assert conflictDecision == #conflict;
assert conflict.phase == #conflict;

// Invalid financial material cannot be journaled or reach a future authority.
assert Intent.prepare({ input with journalSequence = 0 }) == null;
assert Intent.prepare({ input with amountBaseUnits = 0 }) == null;
assert Intent.prepare({ input with assetDecimals = 39 }) == null;
assert Intent.prepare({ input with accountId = "bad\naccount" }) == null;
assert Intent.prepare({ input with contentHash = Blob.fromArray([9]) }) == null;
