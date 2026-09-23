import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Option "mo:base/Option";
import Archive "../canisters/archive_router/MigrationReceiptArchiveRecovery";
import Export "../canisters/archive_router/MigrationReceiptArchiveExport";
import Receipt "../canisters/archive_router/MigrationReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let receipt : Receipt.Input = {
  logicalId = "migration-receipt:v1:canonical:User:7";
  migrationId = "migration:canonical";
  sourceTable = "User";
  chunk = 7;
  rowCount = 500;
  payloadHash = hash(4);
  desiredVersion = 1;
  contentHash = hash(9);
};

let first = Option.unwrap(Export.encode(receipt));
let second = Option.unwrap(Export.encode(receipt));
assert first == second;
assert Blob.toArray(first).size() <= Export.maxEncodedBytes;

// Each immutable metadata field affects the bytes; source rows never appear.
assert first != Option.unwrap(Export.encode({ receipt with migrationId = "migration:other" }));
assert first != Option.unwrap(Export.encode({ receipt with sourceTable = "Role" }));
assert first != Option.unwrap(Export.encode({ receipt with chunk = 8 }));
assert first != Option.unwrap(Export.encode({ receipt with rowCount = 499 }));
assert first != Option.unwrap(Export.encode({ receipt with payloadHash = hash(5) }));
assert first != Option.unwrap(Export.encode({ receipt with contentHash = hash(10) }));

let tuple : Archive.ArchiveTuple = {
  logicalId = receipt.logicalId;
  version = receipt.desiredVersion;
  contentHash = receipt.contentHash;
};
assert Export.tupleNamesReceipt(tuple, receipt);
assert not Export.tupleNamesReceipt({ tuple with logicalId = "migration-receipt:v1:other" }, receipt);
assert not Export.tupleNamesReceipt({ tuple with version = 2 }, receipt);
assert not Export.tupleNamesReceipt({ tuple with contentHash = hash(1) }, receipt);
assert Export.encode({ receipt with rowCount = 0 }) == null;
assert Export.encode({ receipt with payloadHash = Blob.fromArray([4]) }) == null;
