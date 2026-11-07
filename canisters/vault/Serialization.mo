import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Sha256 "mo:sha2@0/Sha256";

module {
  public type AssetId = {
    ledger : Principal;
    symbol : Text;
    decimals : Nat8;
  };
  public type Result<T> = { #ok : T; #err : Text };

  let domainPrefix = "meritocracy/icp/v1/";

  public func encodeAsset(asset : AssetId) : Result<Blob> {
    let #ok(symbol) = canonicalSymbol(asset.symbol) else {
      return #err("asset symbol must be non-empty uppercase ASCII letters or digits");
    };
    let principal = Blob.toArray(Principal.toBlob(asset.ledger));
    if (principal.size() > 255) return #err("ledger principal is too long");
    let symbolBytes = Blob.toArray(Text.encodeUtf8(symbol));
    let bytes = Buffer.Buffer<Nat8>(1 + principal.size() + 1 + 4 + symbolBytes.size());
    bytes.add(Nat8.fromNat(principal.size()));
    addAll(bytes, principal);
    bytes.add(asset.decimals);
    addAll(bytes, u32be(symbolBytes.size()));
    addAll(bytes, symbolBytes);
    #ok(Blob.fromArray(Buffer.toArray(bytes)));
  };

  public func deriveSubaccount(asset : AssetId, fundId : Blob, roundId : Nat64) : Result<Blob> {
    if (fundId.size() != 32) return #err("fund id must be exactly 32 bytes");
    let #ok(assetBytes) = encodeAsset(asset) else return #err("invalid asset id");
    #ok(hash(concat([domain("vault-subaccount"), assetBytes, fundId, Blob.fromArray(u64be(roundId))])));
  };

  public func allocationMemo(roundId : Nat64, allocationId : Nat64, allocationVersion : Blob) : Result<Blob> {
    if (allocationVersion.size() != 32) return #err("allocation version must be exactly 32 bytes");
    #ok(
      hash(
        concat([
          domain("allocation-memo"),
          Blob.fromArray(u64be(roundId)),
          Blob.fromArray(u64be(allocationId)),
          allocationVersion,
        ])
      )
    );
  };

  public func domain(purpose : Text) : Blob {
    Text.encodeUtf8(domainPrefix # purpose # "\00");
  };

  func hash(value : Blob) : Blob {
    Sha256.fromBlob(#sha256, value);
  };

  func concat(parts : [Blob]) : Blob {
    var size = 0;
    for (part in parts.vals()) size += part.size();
    let bytes = Buffer.Buffer<Nat8>(size);
    for (part in parts.vals()) addAll(bytes, Blob.toArray(part));
    Blob.fromArray(Buffer.toArray(bytes));
  };

  func addAll(buffer : Buffer.Buffer<Nat8>, values : [Nat8]) {
    for (value in values.vals()) buffer.add(value);
  };

  func canonicalSymbol(symbol : Text) : Result<Text> {
    let chars = Text.toArray(symbol);
    if (chars.size() == 0) return #err("empty asset symbol");
    var normalized = "";
    for (char in chars.vals()) {
      let code = Char.toNat32(char);
      if (code >= 65 and code <= 90 or code >= 48 and code <= 57) {
        normalized #= Char.toText(char);
      } else if (code >= 97 and code <= 122) {
        normalized #= Char.toText(Char.fromNat32(code - 32));
      } else {
        return #err("asset symbol is not ASCII alphanumeric");
      };
    };
    #ok(normalized);
  };

  func u32be(value : Nat) : [Nat8] {
    if (value > 0xffff_ffff) return [];
    Array.tabulate<Nat8>(
      4,
      func(index) {
        let divisor = switch (index) {
          case 0 16_777_216;
          case 1 65_536;
          case 2 256;
          case _ 1;
        };
        Nat8.fromNat((value / divisor) % 256);
      },
    );
  };

  func u64be(value : Nat64) : [Nat8] {
    let bytes = Array.init<Nat8>(8, 0);
    var remaining = value;
    var index = 8;
    while (index > 0) {
      index -= 1;
      bytes[index] := Nat8.fromNat(Nat64.toNat(remaining % 256));
      remaining /= 256;
    };
    Array.freeze(bytes);
  };
};
