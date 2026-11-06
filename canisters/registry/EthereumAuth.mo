import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Ecdsa "mo:ecdsa@7";
import Sha3 "mo:sha3";

module {
  public type Result<T> = { #ok : T; #err : Text };

  public func normalizeAddress(address : Text) : Result<Text> {
    let chars = Text.toArray(address);
    if (chars.size() != 42 or chars[0] != '0' or (chars[1] != 'x' and chars[1] != 'X')) {
      return #err("Ethereum address must be 0x followed by 40 hexadecimal digits");
    };

    var normalized = "0x";
    var index = 2;
    while (index < chars.size()) {
      let code = Char.toNat32(chars[index]);
      if (code >= 48 and code <= 57) {
        normalized #= Char.toText(chars[index]);
      } else if (code >= 65 and code <= 70) {
        normalized #= Char.toText(Char.fromNat32(code + 32));
      } else if (code >= 97 and code <= 102) {
        normalized #= Char.toText(chars[index]);
      } else {
        return #err("Ethereum address contains a non-hexadecimal character");
      };
      index += 1;
    };
    #ok(normalized);
  };

  public func keccak256(bytes : [Nat8]) : Blob {
    let hash = Sha3.Keccak(256);
    hash.update(bytes);
    Blob.fromArray(hash.finalize());
  };

  public func eip191Digest(message : Text) : Blob {
    let messageBytes = Blob.toArray(Text.encodeUtf8(message));
    let prefixBytes = Blob.toArray(Text.encodeUtf8("\19Ethereum Signed Message:\n" # Nat.toText(messageBytes.size())));
    keccak256(Array.append(prefixBytes, messageBytes));
  };

  public func buildLoginMessage(
    address : Text,
    sessionPrincipal : Principal,
    domain : Text,
    action : Text,
    nonceHex : Text,
    issuedAt : Int,
    expiresAt : Int,
  ) : Text {
    "meritocracy/icp/v1/ethereum-session\n" #
    "domain=" # domain # "\n" #
    "action=" # action # "\n" #
    "address=" # address # "\n" #
    "session_principal=" # Principal.toText(sessionPrincipal) # "\n" #
    "issued_at_ns=" # Int.toText(issuedAt) # "\n" #
    "expires_at_ns=" # Int.toText(expiresAt) # "\n" #
    "nonce=" # nonceHex;
  };

  public func subjectHash(normalizedAddress : Text) : Blob {
    keccak256(Blob.toArray(Text.encodeUtf8("meritocracy/icp/v1/ethereum-subject\00" # normalizedAddress)));
  };

  public func deriveAddress(publicKey : Blob) : Result<Text> {
    let bytes = Blob.toArray(publicKey);
    if (bytes.size() != 65) return #err("uncompressed public key must be exactly 65 bytes");
    if (bytes[0] != 0x04) return #err("uncompressed public key must start with 0x04");

    let coordinates = Array.tabulate<Nat8>(64, func(index) { bytes[index + 1] });
    let digest = Blob.toArray(keccak256(coordinates));
    let addressBytes = Array.tabulate<Nat8>(20, func(index) { digest[index + 12] });
    #ok("0x" # hexEncode(addressBytes));
  };

  public func verify(
    challengedAddress : Text,
    message : Text,
    signature : Blob,
    publicKey : Blob,
  ) : Result<()> {
    let #ok(normalizedChallenged) = normalizeAddress(challengedAddress) else {
      return #err("invalid challenged Ethereum address");
    };
    let #ok(derived) = deriveAddress(publicKey) else {
      return #err("invalid Ethereum public key");
    };
    if (not constantTimeTextEqual(normalizedChallenged, derived)) {
      return #err("public key does not match challenged Ethereum address");
    };

    let signatureBytes = Blob.toArray(signature);
    if (signatureBytes.size() != 65) return #err("Ethereum signature must be exactly 65 bytes");
    if (signatureBytes[64] != 27 and signatureBytes[64] != 28) {
      return #err("Ethereum signature recovery byte must be 27 or 28");
    };
    let compact = Array.tabulate<Nat8>(64, func(index) { signatureBytes[index] });

    let curve = Ecdsa.secp256k1Curve();
    let publicKeyBytes = Blob.toArray(publicKey);
    let parsedKey = switch (Ecdsa.publicKeyFromBytes(publicKeyBytes.vals(), #raw({ curve }))) {
      case (#ok(key)) key;
      case (#err(_)) return #err("invalid secp256k1 public key");
    };
    let parsedSignature = switch (Ecdsa.signatureFromBytes(compact.vals(), curve, #raw)) {
      case (#ok(value)) value;
      case (#err(_)) return #err("invalid secp256k1 signature");
    };
    let digest = Blob.toArray(eip191Digest(message));
    if (not parsedKey.verifyHashed(digest.vals(), parsedSignature)) {
      return #err("Ethereum signature verification failed");
    };
    #ok(());
  };

  public func verifyLogin(
    message : Text,
    normalizedAddress : Text,
    signature : Blob,
    publicKey : Blob,
  ) : Result<()> {
    verify(normalizedAddress, message, signature, publicKey);
  };

  func constantTimeTextEqual(left : Text, right : Text) : Bool {
    let leftBytes = Blob.toArray(Text.encodeUtf8(left));
    let rightBytes = Blob.toArray(Text.encodeUtf8(right));
    if (leftBytes.size() != rightBytes.size()) return false;
    var difference : Nat8 = 0;
    let length = leftBytes.size();
    var index = 0;
    while (index < length) {
      difference := Nat8.bitor(difference, Nat8.bitxor(leftBytes[index], rightBytes[index]));
      index += 1;
    };
    difference == 0;
  };

  func hexEncode(bytes : [Nat8]) : Text {
    let digits : [Char] = Text.toArray("0123456789abcdef");
    var encoded = "";
    for (byte in bytes.vals()) {
      let value = Nat8.toNat(byte);
      encoded #= Char.toText(digits[value / 16]);
      encoded #= Char.toText(digits[value % 16]);
    };
    encoded;
  };
};
