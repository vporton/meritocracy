import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Principal "mo:base/Principal";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";
import BaseX "mo:base-x-encoder";

module {
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
    canonical : Text;
  };

  func stripPrincipalSeparators(value : Text) : { #ok : Text; #err : Text } {
    var stripped = "";
    for (character in value.chars()) {
      if (character == '-') {
        // Principal grouping separators are not part of the Base32 payload.
      } else if (
        (character >= 'a' and character <= 'z') or
        (character >= 'A' and character <= 'Z') or
        (character >= '2' and character <= '7')
      ) {
        stripped #= Char.toText(character);
      } else {
        return #err("invalid principal text");
      };
    };
    if (stripped == "") #err("principal is required") else #ok(Text.toLowercase(stripped));
  };

  func parsePrincipal(value : Text) : { #ok : Principal; #err : Text } {
    let stripped = switch (stripPrincipalSeparators(value)) {
      case (#err(message)) return #err(message);
      case (#ok(result)) result;
    };
    let decoded = switch (BaseX.fromBase32(stripped, #standard)) {
      case (#err(_)) return #err("invalid principal text");
      case (#ok(bytes)) bytes;
    };
    if (decoded.size() < 4 or decoded.size() > 33) return #err("invalid principal text");
    let principalBytes = Array.tabulate<Nat8>(decoded.size() - 4, func(index) { decoded[index + 4] });
    let owner = Principal.fromBlob(Blob.fromArray(principalBytes));
    let canonical = Principal.toText(owner);
    let canonicalStripped = switch (stripPrincipalSeparators(canonical)) {
      case (#err(_)) return #err("invalid principal text");
      case (#ok(result)) result;
    };
    if (canonicalStripped != stripped) return #err("invalid principal checksum or encoding");
    #ok(owner);
  };

  func hexNibble(character : Char) : ?Nat {
    if (character >= '0' and character <= '9') return ?(Nat32.toNat(Char.toNat32(character)) - Nat32.toNat(Char.toNat32('0')));
    if (character >= 'a' and character <= 'f') return ?(10 + Nat32.toNat(Char.toNat32(character)) - Nat32.toNat(Char.toNat32('a')));
    if (character >= 'A' and character <= 'F') return ?(10 + Nat32.toNat(Char.toNat32(character)) - Nat32.toNat(Char.toNat32('A')));
    null;
  };

  func parseSubaccount(value : Text) : { #ok : Blob; #err : Text } {
    if (Text.size(value) != 64) return #err("subaccount must contain exactly 64 hexadecimal characters");
    let characters = Text.toArray(value);
    let bytes = Array.tabulate<Nat8>(
      32,
      func(index) {
        let high = switch (hexNibble(characters[index * 2])) {
          case (?nibble) nibble;
          case null 0;
        };
        let low = switch (hexNibble(characters[index * 2 + 1])) {
          case (?nibble) nibble;
          case null 0;
        };
        Nat8.fromNat(high * 16 + low);
      },
    );
    for (character in characters.vals()) {
      if (hexNibble(character) == null) return #err("subaccount must be hexadecimal");
    };
    #ok(Blob.fromArray(bytes));
  };

  func subaccountText(subaccount : Blob) : Text {
    BaseX.toHex(subaccount.vals(), { prefix = #none; isUpper = false });
  };

  public func parse(value : Text) : { #ok : Account; #err : Text } {
    let parts = Text.split(value, #char(':'));
    let ownerText = switch (parts.next()) {
      case null return #err("principal is required");
      case (?text) text;
    };
    let owner = switch (parsePrincipal(ownerText)) {
      case (#err(message)) return #err(message);
      case (#ok(result)) result;
    };
    let subaccount = switch (parts.next()) {
      case null null;
      case (?text) switch (parseSubaccount(text)) {
        case (#err(message)) return #err(message);
        case (#ok(result)) ?result;
      };
    };
    if (parts.next() != null) return #err("ICRC account must contain at most one subaccount separator");
    let canonical = Principal.toText(owner) # (
      switch (subaccount) {
        case null "";
        case (?value) ":" # subaccountText(value);
      }
    );
    #ok({ owner; subaccount; canonical });
  };
};
