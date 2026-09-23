import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/application/EmbeddedTreasuryOperationOutboxStore";
import Saga "../canisters/application/TreasuryOperationSaga";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : Saga.Input = {
  logicalId = "application-treasury:v1:outbox-17";
  version = 1;
  contentHash = hash(9);
};

assert Store.validEncoding(input);
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(9) }) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ version = 2; contentHash = hash(9) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(10) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with logicalId = "bad\nlogical-id" });
assert not Store.validEncoding({ input with contentHash = Blob.fromArray([9]) });
