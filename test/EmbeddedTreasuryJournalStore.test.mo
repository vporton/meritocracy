import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/treasury/EmbeddedTreasuryJournalStore";
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
let exact : Store.ImmutableObservation = {
  journalSequence = input.journalSequence;
  operationId = input.operationId;
  accountId = input.accountId;
  assetId = input.assetId;
  direction = input.direction;
  amountBaseUnits = input.amountBaseUnits;
  assetDecimals = input.assetDecimals;
  version = input.desiredVersion;
  contentHash = input.contentHash;
};
assert Store.decideIdempotentWrite(input, ?exact) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ exact with journalSequence = 18 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with operationId = "op:substituted" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with accountId = "treasury:held" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with assetId = "icrc1:ledger:OTHER" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with direction = #credit }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with amountBaseUnits = 18 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with assetDecimals = 9 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with version = 2 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with contentHash = hash(3) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with journalSequence = 0 });
assert not Store.validEncoding({ input with amountBaseUnits = 0 });
assert not Store.validEncoding({ input with assetDecimals = 39 });
assert not Store.validEncoding({ input with accountId = "bad\naccount" });
assert not Store.validEncoding({ input with contentHash = Blob.fromArray([1]) });
