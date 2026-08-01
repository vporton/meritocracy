import Principal "mo:base/Principal";
import OAuthAttempt "../canisters/oauth_fixture/OAuthAttempt";

let anonymous = Principal.fromText("2vxsx-fae");
let boundCaller = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let otherCaller = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

func vector(
  caller : Principal,
  attemptCaller : Principal,
  provider : OAuthAttempt.Provider,
  nowNs : Int,
  expiresAtNs : Int,
  expectedState : Text,
  presentedState : Text,
  consumed : Bool,
) : OAuthAttempt.Vector {
  {
    caller;
    attemptCaller;
    provider;
    nowNs;
    expiresAtNs;
    expectedState;
    presentedState;
    consumed;
  };
};

assert (
  OAuthAttempt.evaluate(vector(anonymous, anonymous, #github, 1, 2, "state", "state", false)) == #anonymousCaller
);
assert (
  OAuthAttempt.evaluate(vector(otherCaller, boundCaller, #github, 1, 2, "state", "state", false)) == #callerMismatch
);
assert (
  OAuthAttempt.evaluate(vector(boundCaller, boundCaller, #github, 2, 2, "state", "state", false)) == #expired
);
assert (
  OAuthAttempt.evaluate(vector(boundCaller, boundCaller, #github, 1, 2, "state", "copied", false)) == #stateMismatch
);
assert (
  OAuthAttempt.evaluate(vector(boundCaller, boundCaller, #orcid, 1, 2, "state", "state", false)) == #unsupportedProvider
);
assert (
  OAuthAttempt.evaluate(vector(boundCaller, boundCaller, #github, 1, 2, "state", "state", true)) == #replayed
);
assert (
  OAuthAttempt.evaluate(vector(boundCaller, boundCaller, #github, 1, 2, "state", "state", false)) == #accepted
);
