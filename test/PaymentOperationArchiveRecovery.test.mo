import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/treasury/PaymentOperationArchiveRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let expected : Archive.ArchiveTuple = {
  logicalId = "payment-operation:v1:synthetic-44";
  version = 1;
  contentHash = hash(9);
};

assert Archive.validTuple(expected);
assert Archive.decide(expected, ?expected) == #acknowledge;

// An unavailable archive and any non-exact receipt leave the operation
// pending. Neither outcome authorizes a send, replacement operation ID, or
// replacement transaction material.
assert Archive.decide(expected, null) == #remainPending;
assert Archive.decide(expected, ?{ expected with version = 2 }) == #remainPending;
assert Archive.decide(expected, ?{ expected with contentHash = hash(8) }) == #remainPending;
assert Archive.decide(expected, ?{ expected with logicalId = "payment-operation:v1:synthetic-45" }) == #remainPending;

// Invalid source or receipt material fails closed before any future archive
// acknowledgement can influence the payment-operation saga.
assert not Archive.validTuple({ expected with logicalId = "bad\nlogical-id" });
assert not Archive.validTuple({ expected with contentHash = Blob.fromArray([]) });
assert Archive.decide({ expected with contentHash = Blob.fromArray([]) }, ?expected) == #blocked;
assert Archive.decide(expected, ?{ expected with contentHash = Blob.fromArray([]) }) == #blocked;
