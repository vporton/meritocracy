import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import { test } "mo:test";
import Serialization "../canisters/vault/Serialization";

func hexNibble(char : Char) : Nat8 {
  let code = Char.toNat32(char);
  if (code >= 48 and code <= 57) return Nat8.fromNat(Nat32.toNat(code - 48));
  if (code >= 65 and code <= 70) return Nat8.fromNat(Nat32.toNat(code - 55));
  if (code >= 97 and code <= 102) return Nat8.fromNat(Nat32.toNat(code - 87));
  Debug.trap("invalid hexadecimal fixture");
};

func hex(value : Text) : Blob {
  let chars = Text.toArray(value);
  assert chars.size() % 2 == 0;
  Blob.fromArray(
    Array.tabulate<Nat8>(
      chars.size() / 2,
      func(index) {
        let position = index * 2;
        hexNibble(chars[position]) * 16 + hexNibble(chars[position + 1]);
      },
    )
  );
};

let asset : Serialization.AssetId = {
  ledger = Principal.fromBlob(Blob.fromArray([0x04]));
  decimals = 8;
  symbol = "ICP";
};
let fund = hex("2222222222222222222222222222222222222222222222222222222222222222");
let version = hex("1111111111111111111111111111111111111111111111111111111111111111");

test(
  "asset encoding matches the v1 fixture",
  func() {
    assert Serialization.encodeAsset(asset) == #ok(hex("01040800000003494350"));
    assert Serialization.encodeAsset({ asset with symbol = "icp" }) == Serialization.encodeAsset(asset);
  },
);

test(
  "vault subaccount matches the v1 fixture",
  func() {
    assert Serialization.deriveSubaccount(asset, fund, 42) == #ok(hex("657038fd3cca99120e4478fdafb6d08b0564a8a34547d194538d260ad80e9c79"));
  },
);

test(
  "allocation memo matches the v1 fixture",
  func() {
    assert Serialization.allocationMemo(42, 7, version) == #ok(hex("13244fb88d7e69d1ef98b1f42279d8d14d31ce14ffef609b6d8358745052f701"));
  },
);

test(
  "derived identities bind every input and reject noncanonical lengths",
  func() {
    let #ok(base) = Serialization.deriveSubaccount(asset, fund, 42) else Debug.trap("fixture failed");
    let #ok(otherRound) = Serialization.deriveSubaccount(asset, fund, 43) else Debug.trap("round failed");
    let #ok(otherAsset) = Serialization.deriveSubaccount({ asset with decimals = Nat8.fromNat(9) }, fund, 42) else Debug.trap("asset failed");
    let #ok(otherFund) = Serialization.deriveSubaccount(asset, Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x23 })), 42) else Debug.trap("fund failed");
    assert base != otherRound;
    assert base != otherAsset;
    assert base != otherFund;
    assert Serialization.deriveSubaccount(asset, Blob.fromArray([0]), 42) == #err("fund id must be exactly 32 bytes");
    assert Serialization.allocationMemo(42, 7, Blob.fromArray([0])) == #err("allocation version must be exactly 32 bytes");
    assert Serialization.encodeAsset({ asset with symbol = "ICP-" }) == #err("asset symbol must be non-empty uppercase ASCII letters or digits");
  },
);
