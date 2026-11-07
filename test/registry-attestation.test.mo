import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import { test } "mo:test";
import Attestation "../canisters/registry/Attestation";

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

let referenceHash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0xab }));
let canonical = "meritocracy/icp/v1/eligibility-attestation\n" #
"user_id=42\n" #
"issuer=fixture-issuer\n" #
"status=eligible\n" #
"reference_hash=abababababababababababababababababababababababababababababababab\n" #
"issued_at_ns=1700000000000000000\n" #
"expires_at_ns=1700000300000000000";
let publicKey = hex("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
let signature = hex("9e76273ae283a3862716db47d245564f759501737c839b830632f5ab30eea3a37e72077f5c3157bd66f369115abb8f01c0f5cf1e785eb7214783428d00a79209");

test(
  "eligibility attestation canonicalization is stable",
  func() {
    assert Attestation.message(42, "fixture-issuer", #eligible, referenceHash, 1_700_000_000_000_000_000, ?1_700_000_300_000_000_000) == canonical;
  },
);

test(
  "Ed25519 verifies the canonical eligibility attestation",
  func() {
    assert Attestation.verify(publicKey, signature, canonical);
    assert not Attestation.verify(publicKey, signature, canonical # "!");
    assert not Attestation.verify(Blob.fromArray([0]), signature, canonical);
    assert not Attestation.verify(publicKey, Blob.fromArray([0]), canonical);
  },
);
