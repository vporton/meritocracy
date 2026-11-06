/// M1 canonical migration codec.  It is deliberately a pure module: callers
/// provide already-redacted, typed values and can compare bytes/hashes before
/// any storage mutation.  General PostgreSQL decoding remains a G2 concern.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Order "mo:base/Order";
import Sha256 "mo:sha2/Sha256";
import Text "mo:base/Text";

module {
  public let format = "meritocracy-migration-canonical-v1";

  public type Value = {
    #nil;
    #bool : Bool;
    #text : Text;
    #array : [Value];
    #map : [(Text, Value)];
  };

  func hex(bytes : Blob) : Text {
    let digits : [Char] = ['0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'];
    var output = "";
    for (byte in Blob.toArray(bytes).vals()) {
      let value = Nat8.toNat(byte);
      output := Text.concat(Text.concat(output, Text.fromChar(digits[value / 16])), Text.fromChar(digits[value % 16]));
    };
    output;
  };

  // M1 vectors use already-validated strings without JSON control characters.
  // G2 must extend this to the complete tagged PostgreSQL text domain before
  // any production export is permitted.
  func escape(text : Text) : Text { text };

  func sorted(fields : [(Text, Value)]) : [(Text, Value)] {
    Array.sort<(Text, Value)>(fields, func (left, right) { Text.compare(left.0, right.0) });
  };

  public func canonical(value : Value) : Text {
    switch (value) {
      case (#nil) "null";
      case (#bool(value)) if (value) "true" else "false";
      case (#text(value)) Text.concat(Text.concat("\"", escape(value)), "\"");
      case (#array(values)) {
        var result = "[";
        var first = true;
        for (item in values.vals()) { if (not first) result := Text.concat(result, ","); result := Text.concat(result, canonical(item)); first := false };
        Text.concat(result, "]");
      };
      case (#map(fields)) {
        var result = "{";
        var first = true;
        for ((key, item) in sorted(fields).vals()) { if (not first) result := Text.concat(result, ","); result := Text.concat(result, Text.concat(Text.concat(canonical(#text(key)), ":"), canonical(item))); first := false };
        Text.concat(result, "}");
      };
    };
  };

  public func sha256Hex(bytes : Text) : Text { hex(Sha256.fromBlob(#sha256, Text.encodeUtf8(bytes))) };

  public func logicalId(table : Text, primaryKey : Value) : Text {
    Text.concat(Text.concat(Text.concat("legacy/", table), "/"), sha256Hex(canonical(primaryKey)));
  };

  /// Adds sourceRowHash after hashing the canonical source envelope, exactly
  /// as the Node M1 vector does.
  public func canonicalRow(table : Text, primaryKey : Value, row : Value) : (Text, Text) {
    let logical = logicalId(table, primaryKey);
    let source = #map([("format", #text(format)), ("logicalId", #text(logical)), ("pk", primaryKey), ("row", row), ("table", #text(table))]);
    let hash = sha256Hex(canonical(source));
    let complete = #map([("format", #text(format)), ("logicalId", #text(logical)), ("pk", primaryKey), ("row", row), ("sourceRowHash", #text(hash)), ("table", #text(table))]);
    (canonical(complete), hash);
  };
};
