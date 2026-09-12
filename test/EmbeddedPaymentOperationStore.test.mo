import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/storage_authority/EmbeddedPaymentOperationStore";
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
assert not Store.validEncoding({ input with amountBaseUnits = 0 });
assert not Store.validEncoding({ input with destinationHash = Blob.fromArray([1]) });
assert not Store.validEncoding({ input with logicalId = "bad\nlogical-id" });
