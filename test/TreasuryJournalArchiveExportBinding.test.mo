import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Binding "../canisters/treasury/TreasuryJournalArchiveExportBinding";
import Journal "../canisters/treasury/TreasuryJournalIntent";
import Option "mo:base/Option";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

func entry(logicalId : Text, sequence : Nat64, direction : Journal.Direction) : Journal.Input {
  {
    logicalId;
    journalSequence = sequence;
    operationId = "payment-operation:v1:archive-binding";
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
  logicalId = "treasury-journal-set:v1:archive-binding";
  entries = [entry("treasury-journal:v1:archive-binding:debit", 1, #debit), entry("treasury-journal:v1:archive-binding:credit", 2, #credit)];
};

let binding = Option.unwrap(Binding.prepare(set, 1));
assert Blob.toArray(binding.tuple.contentHash).size() == 32;
assert Binding.matches(set, binding);
assert Binding.prepare(set, 0) == null;

// Neither a replacement hash nor replacement canonical bytes can name this
// immutable set's retained archive tuple.
assert not Binding.matches(set, { binding with tuple = { binding.tuple with contentHash = hash(99) } });
assert not Binding.matches(set, { binding with bytes = Blob.fromArray([0]) });

// Entry order is already fixed by the balanced set and survives the binding.
let reordered = { set with entries = [set.entries[1], set.entries[0]] };
assert not Binding.matches(reordered, binding);
