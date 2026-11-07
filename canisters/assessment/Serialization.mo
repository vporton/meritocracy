import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Sha256 "mo:sha2@0/Sha256";
import Types "Types";

module {
  let prefix = "meritocracy/icp/v1/assessment/";
  public func inputHash(text : Text) : Blob = hash([domain("input"), variable(Text.encodeUtf8(text))]);
  public func requestFingerprint(user : Nat64, input : Blob, sources : [Types.SourceRef], prompt : Blob, model : Text) : ?Blob {
    if (input.size() != 32 or prompt.size() != 32) return null;
    let sorted = Array.sort<Types.SourceRef>(sources, func(a, b) { Nat32.compare(a.ordinal, b.ordinal) });
    let parts = Buffer.Buffer<Blob>(5 + sorted.size() * 3);
    parts.add(domain("request"));
    parts.add(Blob.fromArray(u64(user)));
    parts.add(input);
    parts.add(prompt);
    parts.add(variable(Text.encodeUtf8(model)));
    var prior : ?Nat32 = null;
    for (source in sorted.vals()) {
      if (source.uri_hash.size() != 32 or prior == ?source.ordinal) return null;
      prior := ?source.ordinal;
      parts.add(Blob.fromArray(u32(Nat32.toNat(source.ordinal))));
      parts.add(source.uri_hash);
      parts.add(switch (source.allowed_uri) { case null Blob.fromArray([0]); case (?uri) concat([Blob.fromArray([1]), variable(Text.encodeUtf8(uri))]) });
    };
    ?hash(Buffer.toArray(parts));
  };
  public func attemptToken(id : Nat64, attempt : Nat32, fingerprint : Blob) : Blob = hash([domain("attempt"), Blob.fromArray(u64(id)), Blob.fromArray(u32(Nat32.toNat(attempt))), fingerprint]);
  public func resultHash(outcome : Types.EvaluationOutcome) : Blob = switch (outcome) {
    case (#accepted(value)) hash([domain("result-accepted"), unsigned(value.weight_numerator), unsigned(value.weight_denominator)]);
    case (#rejected(code)) hash([domain("result-rejected"), variable(Text.encodeUtf8(code))]);
  };
  public func proposalHash(id : Nat64, user : Nat64, result : Blob) : Blob = hash([domain("proposal"), Blob.fromArray(u64(id)), Blob.fromArray(u64(user)), result]);
  public func auditHash(id : Nat64, kind : Text, payload : Blob) : Blob = hash([domain("audit"), Blob.fromArray(u64(id)), variable(Text.encodeUtf8(kind)), payload]);
  func domain(value : Text) : Blob = Text.encodeUtf8(prefix # value # "\00");
  func hash(parts : [Blob]) : Blob = Sha256.fromBlob(#sha256, concat(parts));
  func variable(value : Blob) : Blob = concat([Blob.fromArray(u32(value.size())), value]);
  func unsigned(value : Nat) : Blob {
    if (value == 0) return Blob.fromArray([0, 0, 0, 0]);
    var n = value;
    var reversed : [Nat8] = [];
    while (n > 0) {
      reversed := Array.append(reversed, [Nat8.fromNat(n % 256)]);
      n /= 256;
    };
    variable(Blob.fromArray(Array.tabulate<Nat8>(reversed.size(), func(i) { reversed[reversed.size() - i - 1] })));
  };
  func concat(parts : [Blob]) : Blob {
    let out = Buffer.Buffer<Nat8>(0);
    for (part in parts.vals()) for (byte in Blob.toArray(part).vals()) out.add(byte);
    Blob.fromArray(Buffer.toArray(out));
  };
  func u32(value : Nat) : [Nat8] = Array.tabulate<Nat8>(4, func(i) { Nat8.fromNat((value / [16_777_216, 65_536, 256, 1][i]) % 256) });
  func u64(value : Nat64) : [Nat8] {
    let out = Array.init<Nat8>(8, 0);
    var n = value;
    var i = 8;
    while (i > 0) {
      i -= 1;
      out[i] := Nat8.fromNat(Nat64.toNat(n % 256));
      n /= 256;
    };
    Array.freeze(out);
  };
};
