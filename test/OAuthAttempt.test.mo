import Principal "mo:base/Principal";
import Attempt "../canisters/oauth_attempt_fixture/OAuthAttempt";

let anonymous = Principal.fromText("2vxsx-fae");
let alice = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let bob = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

let valid = switch (Attempt.begin(alice, ?#github, "login", "state-a", "challenge-a", "https://app.example.test/oauth/callback", 100, 200)) {
  case (#ok(attempt)) attempt;
  case (#err(_)) {
    assert false;
    {
      caller = alice;
      provider = #github;
      purpose = "unreachable";
      state = "unreachable";
      pkceChallenge = "unreachable";
      redirect = "https://app.example.test/oauth/callback";
      expiresAtNs = 0;
    };
  };
};

// Mops executes this top-level vector without a test-framework dependency.
assert Attempt.begin(anonymous, ?#github, "login", "state-a", "challenge-a", "https://app.example.test/oauth/callback", 100, 200) == #err(#anonymousCaller);
assert Attempt.complete(valid, bob, "state-a", 150) == #err(#callerMismatch);
assert Attempt.complete(valid, alice, "state-a", 201) == #err(#expired);
assert Attempt.begin(alice, null, "login", "state-a", "challenge-a", "https://app.example.test/oauth/callback", 100, 200) == #err(#unsupportedProvider);
assert Attempt.complete(valid, alice, "state-a", 200) == #ok(());
