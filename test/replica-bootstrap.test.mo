import { test } "mo:test";

persistent actor {
  public func runTests() : async () {
    test(
      "PocketIC bootstrap",
      func() {
        assert true;
      },
    );
  };
};
