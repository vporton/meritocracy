import { suite; test } "mo:test";
import Icrc1 "../canisters/vault/Icrc1";

suite(
  "vault ICRC-1 result classification",
  func() {
    test(
      "accepts ledger success and duplicate as the same authoritative receipt",
      func() {
        assert Icrc1.successfulBlock(#Ok(41)) == ?41;
        assert Icrc1.successfulBlock(#Err(#Duplicate({ duplicate_of = 41 }))) == ?41;
        assert Icrc1.successfulBlock(#Err(#TemporarilyUnavailable)) == null;
      },
    );

    test(
      "separates fee refresh and temporary failure from permanent errors",
      func() {
        assert Icrc1.classify(#BadFee({ expected_fee = 15_000 })) == #bad_fee(15_000);
        assert Icrc1.classify(#TemporarilyUnavailable) == #retryable("ledger temporarily unavailable");
        switch (Icrc1.classify(#InsufficientFunds({ balance = 9 }))) {
          case (#permanent(_)) {};
          case _ assert false;
        };
      },
    );
  },
);
