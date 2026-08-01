import OAuthAttempt "OAuthAttempt";

/// Test-only Candid surface for deterministic M1 protocol vectors.
/// `caller` inside a vector is simulated input, never an authentication source.
persistent actor {
  public query func evaluateAttemptVector(
    vector : OAuthAttempt.Vector
  ) : async OAuthAttempt.Result {
    OAuthAttempt.evaluate(vector);
  };
};
