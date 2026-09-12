import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Intent "../canisters/archive_router/MigrationReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Intent.Input = {
  logicalId = "migration-receipt:v1:synthetic-44:users:7";
  migrationId = "synthetic-migration-44";
  sourceTable = "User";
  chunk = 7;
  rowCount = 500;
  payloadHash = hash(4);
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

// Invalid receipt metadata never becomes a durable intent or reaches a
// future import/storage boundary.
assert Intent.prepare({ input with rowCount = 0 }) == null;
assert Intent.prepare({ input with rowCount = 501 }) == null;
assert Intent.prepare({ input with payloadHash = Blob.fromArray([4]) }) == null;
assert Intent.prepare({ input with sourceTable = "User\n" }) == null;
assert Intent.prepare({ input with migrationId = "" }) == null;
