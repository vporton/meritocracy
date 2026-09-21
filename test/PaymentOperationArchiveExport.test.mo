import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Archive "../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../canisters/treasury/PaymentOperationArchiveExportBinding";
import Export "../canisters/treasury/PaymentOperationArchiveExport";
import Operation "../canisters/treasury/PaymentOperationIntent";
import Option "mo:base/Option";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let operation : Operation.Input = {
  logicalId = "payment-operation:v1:canonical-export";
  operationId = "operation:canonical-export";
  obligationId = "obligation:canonical-export";
  assetId = "icrc1:ledger:TEST";
  amountBaseUnits = 125_000;
  assetDecimals = 8;
  destinationHash = hash(7);
  desiredVersion = 1;
  contentHash = hash(9);
};

let first = Option.unwrap(Export.encode(operation));
let second = Option.unwrap(Export.encode(operation));
assert first == second;
assert Blob.toArray(first).size() <= Export.maxEncodedBytes;

// Every immutable field is bound into the export; an altered value produces
// distinct bytes and cannot be concealed by a matching logical ID.
assert first != Option.unwrap(Export.encode({ operation with amountBaseUnits = 125_001 }));
assert first != Option.unwrap(Export.encode({ operation with destinationHash = hash(8) }));
assert first != Option.unwrap(Export.encode({ operation with contentHash = hash(10) }));

let tuple : Archive.ArchiveTuple = {
  logicalId = operation.logicalId;
  version = operation.desiredVersion;
  contentHash = operation.contentHash;
};
assert Export.tupleNamesOperation(tuple, operation);
assert not Export.tupleNamesOperation({ tuple with version = 2 }, operation);
assert not Export.tupleNamesOperation({ tuple with contentHash = hash(1) }, operation);
let binding = Option.unwrap(Binding.prepare(operation));
assert Blob.toArray(binding.tuple.contentHash).size() == 32;
assert binding.tuple.contentHash != operation.contentHash;
assert Binding.matches(operation, binding);
assert Export.archiveTupleNamesOperation(binding.tuple, operation);
assert not Export.archiveTupleNamesOperation({ binding.tuple with version = 2 }, operation);
assert not Binding.matches({ operation with amountBaseUnits = 125_001 }, binding);
assert not Binding.matches(operation, { binding with bytes = Blob.fromArray([0]) });
assert not Binding.matches(operation, { binding with tuple = { binding.tuple with contentHash = hash(11) } });
assert Export.encode({ operation with amountBaseUnits = 0 }) == null;
assert Export.encode({ operation with destinationHash = Blob.fromArray([7]) }) == null;
