import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Binding "../canisters/archive_router/MigrationReceiptArchiveExportBinding";
import Receipt "../canisters/archive_router/MigrationReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let receipt : Receipt.Input = {
  logicalId = "migration-receipt:v1:archive-binding:User:7";
  migrationId = "migration:archive-binding";
  sourceTable = "User";
  chunk = 7;
  rowCount = 500;
  payloadHash = hash(4);
  desiredVersion = 1;
  contentHash = hash(9);
};

let ?binding = Binding.prepare(receipt) else { assert false; loop {} };
assert Binding.matches(receipt, binding);
assert not Binding.matches({ receipt with sourceTable = "Role" }, binding);
assert not Binding.matches({ receipt with payloadHash = hash(5) }, binding);
assert not Binding.matches({ receipt with contentHash = hash(10) }, binding);
assert not Binding.matches(receipt, { binding with bytes = Blob.fromArray([1]) });
assert Binding.prepare({ receipt with rowCount = 0 }) == null;
