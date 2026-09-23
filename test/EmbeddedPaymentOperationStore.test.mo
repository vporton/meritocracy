import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/treasury/EmbeddedPaymentOperationStore";
import PaymentOperation "../canisters/treasury/PaymentOperationIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let input : PaymentOperation.Input = {
  logicalId = "payment-operation:v1:embedded-17";
  operationId = "op:embedded-17";
  obligationId = "obligation:embedded-17";
  assetId = "icrc1:ledger:TEST";
  amountBaseUnits = 17;
  assetDecimals = 8;
  destinationHash = hash(1);
  desiredVersion = 1;
  contentHash = hash(2);
};

// The private collection record carries only validated fixed operation data;
// destination material remains hash-only and the record is within the M1
// document limit. Invalid candidates cannot be encoded for a future write.
assert Store.validEncoding(input);
let exact : Store.ImmutableObservation = {
  operationId = input.operationId;
  obligationId = input.obligationId;
  assetId = input.assetId;
  amountBaseUnits = input.amountBaseUnits;
  assetDecimals = input.assetDecimals;
  destinationHash = input.destinationHash;
  version = input.desiredVersion;
  contentHash = input.contentHash;
};
assert Store.decideIdempotentWrite(input, ?exact) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ exact with operationId = "op:substituted" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with obligationId = "obligation:substituted" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with assetId = "icrc1:ledger:OTHER" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with amountBaseUnits = 18 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with assetDecimals = 9 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with destinationHash = hash(3) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with version = 2 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ exact with contentHash = hash(3) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with amountBaseUnits = 0 });
assert not Store.validEncoding({
  input with destinationHash = Blob.fromArray([1])
});
assert not Store.validEncoding({ input with logicalId = "bad\nlogical-id" });
