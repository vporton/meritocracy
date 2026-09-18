import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/treasury/TreasuryJournalArchiveRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let expected : Archive.ArchiveTuple = {
  logicalId = "treasury-journal-set:v1:synthetic-archive";
  version = 1;
  contentHash = hash(9);
};

assert Archive.validTuple(expected);
assert Archive.decide(expected, ?expected) == #acknowledge;

// Archive availability, a lost reply, or a competing receipt never changes
// journal authority, replaces a posting, or permits a balance projection.
assert Archive.decide(expected, null) == #remainPending;
assert Archive.decide(expected, ?{ expected with version = 2 }) == #remainPending;
assert Archive.decide(expected, ?{ expected with contentHash = hash(8) }) == #remainPending;
assert Archive.decide(expected, ?{ expected with logicalId = "treasury-journal-set:v1:other" }) == #remainPending;

// Invalid retained or observed tuples fail closed before a future durable
// archive saga can acknowledge them.
assert not Archive.validTuple({ expected with logicalId = "bad\nlogical-id" });
assert not Archive.validTuple({ expected with contentHash = Blob.fromArray([]) });
assert Archive.decide({ expected with contentHash = Blob.fromArray([]) }, ?expected) == #blocked;
assert Archive.decide(expected, ?{ expected with contentHash = Blob.fromArray([]) }) == #blocked;
