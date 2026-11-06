import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Int "mo:base/Int";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import EdDSA "mo:eddsa";

module {
  public type Status = { #eligible; #ineligible };

  public func message(
    userId : Nat64,
    issuer : Text,
    status : Status,
    referenceHash : Blob,
    issuedAt : Int,
    expiresAt : ?Int,
  ) : Text {
    "meritocracy/icp/v1/eligibility-attestation\n" #
    "user_id=" # Nat64.toText(userId) # "\n" #
    "issuer=" # issuer # "\n" #
    "status=" # (switch (status) { case (#eligible) "eligible"; case (#ineligible) "ineligible" }) # "\n" #
    "reference_hash=" # hex(referenceHash) # "\n" #
    "issued_at_ns=" # Int.toText(issuedAt) # "\n" #
    "expires_at_ns=" # (switch (expiresAt) { case null "none"; case (?value) Int.toText(value) });
  };

  public func verify(publicKey : Blob, signature : Blob, canonicalMessage : Text) : Bool {
    if (publicKey.size() != 32 or signature.size() != 64) return false;
    let key = switch (EdDSA.publicKeyFromBytes(publicKey.vals(), #raw({ curve = #ed25519 }))) {
      case (#err(_)) return false;
      case (#ok(value)) value;
    };
    let parsedSignature = switch (EdDSA.signatureFromBytes(signature.vals(), #raw({ curve = #ed25519 }))) {
      case (#err(_)) return false;
      case (#ok(value)) value;
    };
    key.verify(Blob.toArray(Text.encodeUtf8(canonicalMessage)).vals(), parsedSignature);
  };

  func hex(value : Blob) : Text {
    let digits : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    var result = "";
    for (byte in value.vals()) {
      let number = Nat8.toNat(byte);
      result #= Char.toText(digits[number / 16]) # Char.toText(digits[number % 16]);
    };
    result;
  };
};
