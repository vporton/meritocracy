import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Option "mo:base/Option";
import Archive "../canisters/treasury/TreasuryJournalArchiveRecovery";
import Saga "../canisters/treasury/TreasuryJournalArchiveSaga";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let retained : Archive.ArchiveTuple = {
  logicalId = "treasury-journal-set:v1:synthetic-durable-archive";
  version = 1;
  contentHash = hash(9);
};

let prepared = Option.unwrap(Saga.prepare(retained));
assert prepared.phase == #prepared;
assert Saga.startArchive(prepared).phase == #archiveStarted;
assert Saga.retryTuple(prepared) == null;

// A lost reply leaves only the retained tuple retryable. Neither a competing
// receipt nor a retry can supply a new archival tuple.
let pending = Saga.lostReply(Saga.startArchive(prepared));
assert pending.phase == #pending;
assert Saga.retryTuple(pending) == ?retained;
assert Saga.matchesRetained(pending, retained);
assert not Saga.matchesRetained(pending, { retained with version = 2 });
assert Saga.startArchive(pending).phase == #archiveStarted;
assert Saga.reconcile(pending, ?{ retained with version = 2 }).phase == #pending;
assert Saga.reconcile(pending, null).phase == #pending;

let acknowledged = Saga.reconcile(pending, ?retained);
assert acknowledged.phase == #acknowledged;
assert Saga.retryTuple(acknowledged) == null;
assert Saga.startArchive(acknowledged) == acknowledged;

// Invalid retained/observed tuples cannot enter or unblock recovery.
assert Saga.prepare({ retained with contentHash = Blob.fromArray([]) }) == null;
assert Saga.reconcile(pending, ?{ retained with contentHash = Blob.fromArray([]) }).phase == #blocked;
