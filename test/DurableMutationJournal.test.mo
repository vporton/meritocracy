import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Journal "../canisters/shared/DurableMutationJournal";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func _ = byte));
};

let desired = hash(7);
let other = hash(8);
let prepared = switch (Journal.prepare(Journal.empty, "payment:v1:op-1", "payment:v1:logical-1", desired)) {
  case (#ok(value)) value;
  case (#err(_)) { assert false; (Journal.empty, #duplicate) };
};
assert prepared.1 == #prepared;
assert not Journal.isAcknowledged(prepared.0, "payment:v1:op-1");

// This state is the exact durable checkpoint left when a call is interrupted
// after the external side commits but before this actor records its response.
let retry = Journal.reconcile(prepared.0, "payment:v1:op-1", null);
assert retry == #ok((prepared.0, #retryIdentical));
assert not Journal.isAcknowledged(prepared.0, "payment:v1:op-1");

let reconciled = switch (Journal.reconcile(prepared.0, "payment:v1:op-1", ?desired)) {
  case (#ok(value)) value;
  case (#err(_)) { assert false; (Journal.empty, #retryIdentical) };
};
assert reconciled.1 == #acknowledged;
assert Journal.isAcknowledged(reconciled.0, "payment:v1:op-1");
assert Journal.prepare(reconciled.0, "payment:v1:op-1", "payment:v1:logical-1", desired) == #ok((reconciled.0, #acknowledged));
assert Journal.reconcile(prepared.0, "payment:v1:op-1", ?other) == #err(#resultConflict);
assert Journal.prepare(prepared.0, "payment:v1:op-1", "payment:v1:other-logical-id", desired) == #err(#operationConflict);
assert Journal.prepare(Journal.empty, "", "payment:v1:logical-1", desired) == #err(#invalidOperationId);
assert Journal.prepare(Journal.empty, "payment:v1:op-2", "payment:v1:logical-2", "short") == #err(#invalidHash);
