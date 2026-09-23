import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/application/EmbeddedMigrationReceiptStore";
import Receipt "../canisters/archive_router/MigrationReceiptIntent";

func hash(byte : Nat8) : Blob { Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte })) };

let input : Receipt.Input = {
  logicalId = "migration-receipt:v1:synthetic:User:7"; migrationId = "synthetic-migration";
  sourceTable = "User"; chunk = 7; rowCount = 500; payloadHash = hash(4);
  desiredVersion = 1; contentHash = hash(9);
};

assert Store.validEncoding(input);
let observed : Store.ImmutableObservation = {
  migrationId = input.migrationId; sourceTable = input.sourceTable;
  chunk = 7; rowCount = input.rowCount; payloadHash = input.payloadHash;
  version = 1; contentHash = hash(9);
};
assert Store.decideIdempotentWrite(input, ?observed) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ observed with version = 2 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with contentHash = hash(10) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with migrationId = "other-migration" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with sourceTable = "Role" }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with chunk = 8 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with rowCount = 499 }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ observed with payloadHash = hash(5) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with rowCount = 0 });
assert not Store.validEncoding({ input with payloadHash = Blob.fromArray([4]) });
assert not Store.validEncoding({ input with logicalId = "bad\nlogical-id" });
