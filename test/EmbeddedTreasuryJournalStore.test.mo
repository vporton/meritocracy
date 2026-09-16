import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/storage_authority/EmbeddedTreasuryJournalStore";
import TreasuryJournal "../canisters/treasury/TreasuryJournalIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : TreasuryJournal.Input = {
  logicalId = "treasury-journal:v1:embedded-17";
  journalSequence = 17;
  operationId = "op:embedded-17";
  accountId = "treasury:available";
  assetId = "icrc1:ledger:TEST";
  direction = #debit;
  amountBaseUnits = 17;
  assetDecimals = 8;
  desiredVersion = 1;
  contentHash = hash(2);
};

assert Store.validEncoding(input);
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(2) }) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ version = 2; contentHash = hash(2) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(3) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with journalSequence = 0 });
assert not Store.validEncoding({ input with amountBaseUnits = 0 });
assert not Store.validEncoding({ input with assetDecimals = 39 });
assert not Store.validEncoding({ input with accountId = "bad\naccount" });
assert not Store.validEncoding({ input with contentHash = Blob.fromArray([1]) });
