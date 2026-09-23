import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Option "mo:base/Option";
import Export "../canisters/workflow/CompletionReceiptArchiveExport";
import Receipt "../canisters/workflow/CompletionReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let receipt : Receipt.Input = {
  logicalId = "workflow-completion:v1:archive:quarterly-17";
  cycleId = "cycle:quarterly-17";
  operationName = "publish-quarterly-result";
  desiredVersion = 1;
  contentHash = hash(9);
};

let first = Option.unwrap(Export.encode(receipt));
let second = Option.unwrap(Export.encode(receipt));
assert first == second;
assert Blob.toArray(first).size() <= Export.maxEncodedBytes;

// Every immutable completion-identity field binds the bytes. No workflow
// result, provider payload, task input, or caller principal is available.
assert first != Option.unwrap(Export.encode({ receipt with logicalId = "workflow-completion:v1:archive:other" }));
assert first != Option.unwrap(Export.encode({ receipt with cycleId = "cycle:quarterly-18" }));
assert first != Option.unwrap(Export.encode({ receipt with operationName = "publish-repeat-result" }));
assert first != Option.unwrap(Export.encode({ receipt with desiredVersion = 2 }));
assert first != Option.unwrap(Export.encode({ receipt with contentHash = hash(10) }));

assert Export.tupleNamesReceipt(receipt.logicalId, receipt.desiredVersion, receipt.contentHash, receipt);
assert not Export.tupleNamesReceipt("workflow-completion:v1:archive:other", receipt.desiredVersion, receipt.contentHash, receipt);
assert not Export.tupleNamesReceipt(receipt.logicalId, 2, receipt.contentHash, receipt);
assert not Export.tupleNamesReceipt(receipt.logicalId, receipt.desiredVersion, hash(10), receipt);
assert Export.archiveTupleNamesReceipt(receipt.logicalId, receipt.desiredVersion, hash(11), receipt);
assert not Export.archiveTupleNamesReceipt(receipt.logicalId, receipt.desiredVersion, Blob.fromArray([11]), receipt);
assert Export.encode({ receipt with operationName = "bad\noperation" }) == null;
assert Export.encode({ receipt with contentHash = Blob.fromArray([9]) }) == null;
