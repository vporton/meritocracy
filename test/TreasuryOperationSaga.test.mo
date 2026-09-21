import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Saga "../canisters/application/TreasuryOperationSaga";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Saga.Input = {
  logicalId = "payment-operation:v1:application-outbox-128";
  version = 1;
  contentHash = hash(7);
};
let prepared = switch (Saga.prepare(input)) {
  case (?value) value;
  case null { assert false; loop {} };
};
assert prepared.phase == #prepared;
assert not prepared.active;

// A discarded treasury reply cannot activate an application-side result.
let (retry, absent) = Saga.reconcile(Saga.lostReply(Saga.startTreasuryCall(prepared)), #absent);
assert absent == #retryIdentical;
assert retry.phase == #remoteWriteStarted;
assert not retry.active;

let (acknowledged, exact) = Saga.reconcile(
  Saga.lostReply(Saga.startTreasuryCall(prepared)),
  #present({ version = input.version; contentHash = input.contentHash }),
);
assert exact == #acknowledge;
assert acknowledged.phase == #acknowledged;
assert acknowledged.active;

let (conflicted, conflict) = Saga.reconcile(
  Saga.lostReply(Saga.startTreasuryCall(prepared)),
  #present({ version = input.version + 1; contentHash = input.contentHash }),
);
assert conflict == #conflict;
assert conflicted.phase == #conflict;
assert not conflicted.active;

assert Saga.prepare({ input with logicalId = "" }) == null;
assert Saga.prepare({ input with logicalId = "bad\nlogical-id" }) == null;
assert Saga.prepare({ input with contentHash = Blob.fromArray([]) }) == null;

let (blocked, malformed) = Saga.reconcile(
  Saga.lostReply(Saga.startTreasuryCall(prepared)),
  #present({ version = input.version; contentHash = Blob.fromArray([]) }),
);
assert malformed == #blocked;
assert blocked.phase == #blocked;
assert not blocked.active;
