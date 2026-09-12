import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/shared/IdentityRoleArchiveRecovery";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let expected : Archive.ArchiveTuple = {
  logicalId = "principal-binding:v1:synthetic-44";
  version = 1;
  contentHash = hash(7);
};

let expectedRole : Archive.ArchiveTuple = {
  logicalId = "role-assignment:v1:synthetic-44:auditor";
  version = 1;
  contentHash = hash(8);
};

assert Archive.validTuple(expected);
assert Archive.decide(expected, ?expected) == #acknowledge;
assert Archive.validTuple(expectedRole);
assert Archive.decide(expectedRole, ?expectedRole) == #acknowledge;
assert Archive.decide(expectedRole, ?expected) == #remainPending;

// An unavailable archive and any mismatched receipt leave the source record
// pending. Neither result can activate a record or authorize a replacement.
assert Archive.decide(expected, null) == #remainPending;
assert Archive.decide(expected, ?{ expected with version = 2 }) == #remainPending;
assert Archive.decide(expected, ?{ expected with contentHash = hash(8) }) == #remainPending;
assert Archive.decide(expected, ?{ expected with logicalId = "role-assignment:v1:synthetic-44:auditor" }) == #remainPending;

// Malformed tuples fail closed. In particular, a control character or a
// non-SHA-256-sized hash cannot be treated as an archive acknowledgement.
assert not Archive.validTuple({ expected with logicalId = "bad\nlogical-id" });
assert not Archive.validTuple({ expected with contentHash = Blob.fromArray([]) });
assert Archive.decide({ expected with contentHash = Blob.fromArray([]) }, ?expected) == #blocked;
assert Archive.decide(expected, ?{ expected with contentHash = Blob.fromArray([]) }) == #blocked;
