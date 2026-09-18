import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/treasury/TreasuryJournalArchiveRecovery";
import Export "../canisters/treasury/TreasuryJournalArchiveExport";
import Journal "../canisters/treasury/TreasuryJournalIntent";
import Option "mo:base/Option";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

func entry(logicalId : Text, sequence : Nat64, direction : Journal.Direction) : Journal.Input {
  {
    logicalId;
    journalSequence = sequence;
    operationId = "payment-operation:v1:synthetic";
    accountId = if (direction == #debit) "liability" else "treasury";
    assetId = "ICP";
    direction;
    amountBaseUnits = 25;
    assetDecimals = 8;
    desiredVersion = 1;
    contentHash = hash(if (sequence == 1) 1 else 2);
  };
};

let set = {
  logicalId = "treasury-journal-set:v1:canonical-export";
  entries = [entry("treasury-journal:v1:canonical-export:debit", 1, #debit), entry("treasury-journal:v1:canonical-export:credit", 2, #credit)];
};

let first = Option.unwrap(Export.encode(set));
let second = Option.unwrap(Export.encode(set));
assert first == second;
assert Blob.toArray(first).size() <= Export.maxEncodedBytes;

// Entry order is part of the immutable retained set; an archive exporter may
// not sort, replace, or collapse postings while recovering an archive.
let reordered = { set with entries = [set.entries[1], set.entries[0]] };
let reorderedBytes = Option.unwrap(Export.encode(reordered));
assert first != reorderedBytes;

let tuple : Archive.ArchiveTuple = {
  logicalId = set.logicalId;
  version = 1;
  contentHash = hash(99);
};
assert Export.tupleNamesSet(tuple, set);
assert not Export.tupleNamesSet({ tuple with logicalId = "another-set" }, set);
assert Export.encode({ set with entries = [set.entries[0]] }) == null;
assert Export.encode({ set with logicalId = "" }) == null;
