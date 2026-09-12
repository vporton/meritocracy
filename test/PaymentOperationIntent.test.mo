import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Intent "../canisters/treasury/PaymentOperationIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Intent.Input = {
  logicalId = "payment-operation:v1:synthetic-44";
  operationId = "op:synthetic-44";
  obligationId = "obligation:synthetic-44";
  assetId = "icrc1:ledger:TEST";
  amountBaseUnits = 125_000;
  assetDecimals = 8;
  destinationHash = hash(4);
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
// This is the decision used after an interruption before the authority await:
// only the original durable input can be retried, never replacement material.
assert retry.input == input;

let (conflict, conflictDecision) = Intent.reconcile(
  recovering,
  #present({ version = 2; contentHash = input.contentHash }),
);
assert conflictDecision == #conflict;
assert conflict.phase == #conflict;

// Invalid candidate material cannot become an intent: it therefore cannot
// reach a future storage or chain boundary.
assert Intent.prepare({ input with amountBaseUnits = 0 }) == null;
assert Intent.prepare({ input with destinationHash = Blob.fromArray([4]) }) == null;
assert Intent.prepare({ input with assetDecimals = 39 }) == null;
assert Intent.prepare({ input with operationId = "bad\noperation" }) == null;
