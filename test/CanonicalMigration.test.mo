import Codec "../canisters/shared/CanonicalMigration";

let pk : Codec.Value = #map([("id", #map([("$int", #text("42"))]))]);
let row : Codec.Value = #map([
  ("createdAt", #map([("$timestamp", #map([("assumedZone", #text("UTC")), ("precision", #map([("$int", #text("3"))])), ("value", #text("2026-07-31T12:34:56.789Z"))]))])),
  ("email", #text("alice@example.invalid")),
  ("gdpShare", #map([("$decimal", #map([("coefficient", #text("1200")), ("scale", #map([("$int", #text("3"))]))]))])),
  ("id", #map([("$int", #text("42"))])),
  ("isOnboarded", #bool(true)),
  ("name", #text("Alice")),
]);
let result = Codec.canonicalRow("users", pk, row);
assert result.1 == "a4f1ffbbac28ba182c28d625d0f5a4b41ed371077ff0920f7f4b62c5528f1ab7";
assert result.0 == "{\"format\":\"meritocracy-migration-canonical-v1\",\"logicalId\":\"legacy/users/bb6b0d8b8e37897734ca77ca219888f66ec8b9b0558791976b5241bfafb8c2cd\",\"pk\":{\"id\":{\"$int\":\"42\"}},\"row\":{\"createdAt\":{\"$timestamp\":{\"assumedZone\":\"UTC\",\"precision\":{\"$int\":\"3\"},\"value\":\"2026-07-31T12:34:56.789Z\"}},\"email\":\"alice@example.invalid\",\"gdpShare\":{\"$decimal\":{\"coefficient\":\"1200\",\"scale\":{\"$int\":\"3\"}}},\"id\":{\"$int\":\"42\"},\"isOnboarded\":true,\"name\":\"Alice\"},\"sourceRowHash\":\"a4f1ffbbac28ba182c28d625d0f5a4b41ed371077ff0920f7f4b62c5528f1ab7\",\"table\":\"users\"}";
assert Codec.canonicalRow("users", pk, row) == result;
