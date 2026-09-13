import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Intent "../canisters/workflow/CompletionReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Intent.Input = {
  logicalId = "workflow-completion:v1:synthetic-cycle-44:publish-result";
  cycleId = "synthetic-cycle-44";
  operationName = "publish-result";
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

let (versionConflict, versionDecision) = Intent.reconcile(
  recovering,
  #present({ version = input.desiredVersion + 1; contentHash = input.contentHash }),
);
assert versionDecision == #conflict;
assert versionConflict.phase == #conflict;

let (hashConflict, hashDecision) = Intent.reconcile(
  recovering,
  #present({ version = input.desiredVersion; contentHash = hash(10) }),
);
assert hashDecision == #conflict;
assert hashConflict.phase == #conflict;

// Malformed and unbounded identifiers cannot enter a durable completion
// journal or reach a future fixed storage boundary.
assert Intent.prepare({ input with cycleId = "" }) == null;
assert Intent.prepare({ input with operationName = "publish\nresult" }) == null;
assert Intent.prepare({ input with contentHash = Blob.fromArray([9]) }) == null;
