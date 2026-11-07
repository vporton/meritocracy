import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Sha256 "mo:sha2@0/Sha256";
import Types "Types";

module {
  public type Result<T> = { #ok : T; #err : Text };
  public type VersionEntry = {
    draft : Types.AllocationDraft;
    recipient_hash : ?Types.Hash32;
  };
  let prefix = "meritocracy/icp/v1/";

  public func allocationVersion(roundId : Nat64, asset : Types.AssetId, entries : [VersionEntry]) : Result<Blob> {
    let #ok(assetBytes) = encodeAsset(asset) else return #err("invalid asset id");
    let sorted = Array.sort<VersionEntry>(entries, func(a, b) { Nat64.compare(a.draft.id, b.draft.id) });
    var previous : ?Nat64 = null;
    let parts = Buffer.Buffer<Blob>(3 + sorted.size() * 6);
    parts.add(domain("allocation-version"));
    parts.add(Blob.fromArray(u64be(roundId)));
    parts.add(Blob.fromArray(u32be(sorted.size())));
    for (entry in sorted.vals()) {
      if (entry.draft.amount_atoms == 0) return #err("allocation amount must be positive");
      if (entry.draft.evidence_hash.size() != 32) return #err("evidence hash must be exactly 32 bytes");
      switch (previous) {
        case (?id) if (id == entry.draft.id) return #err("duplicate allocation id");
        case _ {};
      };
      switch (entry.recipient_hash) {
        case (?hash) if (hash.size() != 32) return #err("recipient hash must be exactly 32 bytes");
        case _ {};
      };
      previous := ?entry.draft.id;
      parts.add(Blob.fromArray(u64be(entry.draft.id)));
      parts.add(Blob.fromArray(u64be(entry.draft.user_id)));
      parts.add(assetBytes);
      parts.add(unsignedNat(entry.draft.amount_atoms));
      parts.add(entry.draft.evidence_hash);
      parts.add(switch (entry.recipient_hash) { case null Blob.fromArray([0]); case (?hash) concat([Blob.fromArray([1]), hash]) });
    };
    #ok(Sha256.fromBlob(#sha256, concat(Buffer.toArray(parts))));
  };

  public func recipientSnapshotHash(userId : Nat64, payoutAccountId : Nat64, routeKey : Blob, normalizedAddress : Blob) : Result<Blob> {
    if (routeKey.size() != 32) return #err("route key must be exactly 32 bytes");
    #ok(Sha256.fromBlob(#sha256, concat([domain("recipient-snapshot"), Blob.fromArray(u64be(userId)), Blob.fromArray(u64be(payoutAccountId)), routeKey, variableBlob(normalizedAddress)])));
  };

  public func allocationMemo(roundId : Nat64, allocationId : Nat64, version : Blob) : Result<Blob> {
    if (version.size() != 32) return #err("allocation version must be exactly 32 bytes");
    #ok(Sha256.fromBlob(#sha256, concat([domain("allocation-memo"), Blob.fromArray(u64be(roundId)), Blob.fromArray(u64be(allocationId)), version])));
  };

  public func encodeAsset(asset : Types.AssetId) : Result<Blob> {
    let chars = Text.toArray(asset.symbol);
    if (chars.size() == 0) return #err("asset symbol is empty");
    var symbol = "";
    for (char in chars.vals()) {
      let code = Char.toNat32(char);
      if ((code >= 65 and code <= 90) or (code >= 48 and code <= 57)) symbol #= Char.toText(char) else return #err("asset symbol must be uppercase ASCII alphanumeric");
    };
    let principal = Blob.toArray(Principal.toBlob(asset.ledger));
    if (principal.size() > 255) return #err("ledger principal is too long");
    #ok(concat([Blob.fromArray([Nat8.fromNat(principal.size())]), Blob.fromArray(principal), Blob.fromArray([asset.decimals]), variableBlob(Text.encodeUtf8(symbol))]));
  };

  func domain(value : Text) : Blob { Text.encodeUtf8(prefix # value # "\00") };
  func variableBlob(value : Blob) : Blob {
    concat([Blob.fromArray(u32be(value.size())), value]);
  };
  func unsignedNat(value : Nat) : Blob {
    if (value == 0) return Blob.fromArray([0, 0, 0, 0]);
    var n = value;
    var reversed : [Nat8] = [];
    while (n > 0) {
      reversed := Array.append(reversed, [Nat8.fromNat(n % 256)]);
      n /= 256;
    };
    let magnitude = Array.tabulate<Nat8>(reversed.size(), func(i) { reversed[reversed.size() - i - 1] });
    concat([Blob.fromArray(u32be(magnitude.size())), Blob.fromArray(magnitude)]);
  };
  func concat(parts : [Blob]) : Blob {
    let out = Buffer.Buffer<Nat8>(0);
    for (part in parts.vals()) for (byte in Blob.toArray(part).vals()) out.add(byte);
    Blob.fromArray(Buffer.toArray(out));
  };
  func u32be(value : Nat) : [Nat8] {
    Array.tabulate<Nat8>(4, func(i) { Nat8.fromNat((value / [16_777_216, 65_536, 256, 1][i]) % 256) });
  };
  func u64be(value : Nat64) : [Nat8] {
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
