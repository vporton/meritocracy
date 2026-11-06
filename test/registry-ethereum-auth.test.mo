import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import { test } "mo:test";
import EthereumAuth "../canisters/registry/EthereumAuth";

func hexNibble(char : Char) : Nat8 {
  let code = Char.toNat32(char);
  if (code >= 48 and code <= 57) return Nat8.fromNat(Nat32.toNat(code - 48));
  if (code >= 65 and code <= 70) return Nat8.fromNat(Nat32.toNat(code - 55));
  if (code >= 97 and code <= 102) return Nat8.fromNat(Nat32.toNat(code - 87));
  Debug.trap("invalid hexadecimal fixture");
};

func hex(value : Text) : Blob {
  let chars = Text.toArray(value);
  let offset = if (chars.size() >= 2 and chars[0] == '0' and chars[1] == 'x') 2 else 0;
  assert (chars.size() - offset) % 2 == 0;
  Blob.fromArray(
    Array.tabulate<Nat8>(
      (chars.size() - offset) / 2,
      func(index) {
        let position = offset + index * 2;
        hexNibble(chars[position]) * 16 + hexNibble(chars[position + 1]);
      },
    )
  );
};

let address = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
let message = "meritocracy/icp/v1/ethereum-session\n" #
"domain=app.meritocracy.example\n" #
"action=login\n" #
"address=" # address # "\n" #
"session_principal=aaaaa-aa\n" #
"issued_at_ns=1700000000000000000\n" #
"expires_at_ns=1700000300000000000\n" #
"nonce=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
let publicKey = hex("044646ae5047316b4230d0086c8acec687f00b1cd9d1dc634f6cb358ac0a9a8ffffe77b4dd0a4bfb95851f3b7355c781dd60f8418fc8a65d14907aff47c903a559");
let signature = hex("a44906a4b1087801c5a563a4638b0627ae59f8c21def01c301a917e57a25431b08bb259a15c2592a5e3faab9870115efe2a0d7cbfca96eff10cf04e7e26e06ee1c");

test(
  "Keccak-256 uses the Ethereum padding convention",
  func() {
    assert EthereumAuth.keccak256([]) == hex("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  },
);

test(
  "EIP-191 digest matches ethers",
  func() {
    assert EthereumAuth.eip191Digest(message) == hex("93a3d38fecc78ec3f6033dde6bea08fb2e675e12139bcb28e3a789dd5762b145");
  },
);

test(
  "public key derives the normalized wallet address",
  func() {
    assert EthereumAuth.normalizeAddress("0xFCAd0B19bB29D4674531d6f115237E16AfCE377c") == #ok(address);
    assert EthereumAuth.deriveAddress(publicKey) == #ok(address);
  },
);

test(
  "valid EIP-191 wallet proof verifies",
  func() {
    assert EthereumAuth.verifyLogin(message, address, signature, publicKey) == #ok(());
  },
);

test(
  "wallet proof rejects mutations and invalid recovery bytes",
  func() {
    switch (EthereumAuth.verifyLogin(message # "!", address, signature, publicKey)) {
      case (#err(_)) {};
      case (#ok(_)) assert false;
    };
    switch (EthereumAuth.verifyLogin(message, "0x0000000000000000000000000000000000000000", signature, publicKey)) {
      case (#err(_)) {};
      case (#ok(_)) assert false;
    };
    let signatureBytes = Blob.toArray(signature);
    let invalidRecovery = Blob.fromArray(Array.tabulate<Nat8>(65, func(index) { if (index == 64) 0 else signatureBytes[index] }));
    switch (EthereumAuth.verifyLogin(message, address, invalidRecovery, publicKey)) {
      case (#err(_)) {};
      case (#ok(_)) assert false;
    };
  },
);
