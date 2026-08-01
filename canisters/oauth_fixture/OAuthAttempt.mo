import Principal "mo:base/Principal";

/// A credential-free M1 vector for the caller-binding checks that M2 must retain.
/// It is not an OAuth client and cannot contact a provider or validate a token/code.
module {
  public type Provider = {
    #github;
    #orcid;
    #bitbucket;
    #gitlab;
  };

  public type Vector = {
    caller : Principal;
    attemptCaller : Principal;
    provider : Provider;
    nowNs : Int;
    expiresAtNs : Int;
    expectedState : Text;
    presentedState : Text;
    consumed : Bool;
  };

  public type Result = {
    #accepted;
    #anonymousCaller;
    #callerMismatch;
    #expired;
    #stateMismatch;
    #replayed;
    #unsupportedProvider;
  };

  func providerSupported(provider : Provider) : Bool {
    switch (provider) {
      case (#github) { true };
      case (_) { false };
    };
  };

  public func evaluate(vector : Vector) : Result {
    if (Principal.isAnonymous(vector.caller)) {
      return #anonymousCaller;
    };
    if (not Principal.equal(vector.caller, vector.attemptCaller)) {
      return #callerMismatch;
    };
    if (vector.nowNs >= vector.expiresAtNs) {
      return #expired;
    };
    if (vector.consumed) {
      return #replayed;
    };
    if (not providerSupported(vector.provider)) {
      return #unsupportedProvider;
    };
    if (vector.expectedState != vector.presentedState) {
      return #stateMismatch;
    };
    #accepted;
  };
};
