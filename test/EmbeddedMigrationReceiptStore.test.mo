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
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(9) }) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ version = 2; contentHash = hash(9) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(10) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
// The actual embedded-store fixture separately verifies that an existing
// logical ID cannot substitute this immutable chunk payload hash.
assert not Store.validEncoding({ input with rowCount = 0 });
assert not Store.validEncoding({ input with payloadHash = Blob.fromArray([4]) });
assert not Store.validEncoding({ input with logicalId = "bad\nlogical-id" });
