import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import { test } "mo:test";
import IcrcAccount "../canisters/registry/IcrcAccount";

let owner = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let upperSubaccount = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
let lowerSubaccount = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test(
  "normalizes principal-only ICRC accounts",
  func() {
    switch (IcrcAccount.parse("RRKAH-FQAAA-AAAAA-AAAAQ-CAI")) {
      case (#err(_)) assert false;
      case (#ok(account)) {
        assert account.owner == owner;
        assert account.subaccount == null;
        assert account.canonical == Principal.toText(owner);
      };
    };
  },
);

test(
  "normalizes and decodes a 32-byte ICRC subaccount",
  func() {
    switch (IcrcAccount.parse(Principal.toText(owner) # ":" # upperSubaccount)) {
      case (#err(_)) assert false;
      case (#ok(account)) {
        assert account.owner == owner;
        assert account.canonical == Principal.toText(owner) # ":" # lowerSubaccount;
        switch (account.subaccount) {
          case null assert false;
          case (?value) assert Blob.toArray(value).size() == 32;
        };
      };
    };
  },
);

test(
  "rejects malformed principals and subaccounts",
  func() {
    assert IcrcAccount.parse("not-a-principal") == #err("invalid principal checksum or encoding");
    assert IcrcAccount.parse(Principal.toText(owner) # ":00") == #err("subaccount must contain exactly 64 hexadecimal characters");
    assert IcrcAccount.parse(Principal.toText(owner) # ":" # "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg") == #err("subaccount must be hexadecimal");
    assert IcrcAccount.parse(Principal.toText(owner) # ":" # lowerSubaccount # ":extra") == #err("ICRC account must contain at most one subaccount separator");
  },
);
