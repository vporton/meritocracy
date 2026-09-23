import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/archive_router/MigrationReceiptArchiveRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let expected : Archive.ArchiveTuple = {
  logicalId = "migration-receipt:v1:archive-17";
  version = 1;
  contentHash = hash(9);
};

assert Archive.validTuple(expected);
assert Archive.decide(expected, ?expected) == #acknowledge;
assert Archive.decide(expected, null) == #remainPending;
assert Archive.decide(expected, ?{ expected with logicalId = "migration-receipt:v1:archive-18" }) == #remainPending;
assert Archive.decide(expected, ?{ expected with version = 2 }) == #remainPending;
assert Archive.decide(expected, ?{ expected with contentHash = hash(10) }) == #remainPending;
assert not Archive.validTuple({ expected with logicalId = "bad\nlogical-id" });
assert Archive.decide({ expected with contentHash = Blob.fromArray([9]) }, ?expected) == #blocked;
assert Archive.decide(expected, ?{ expected with contentHash = Blob.fromArray([9]) }) == #blocked;
