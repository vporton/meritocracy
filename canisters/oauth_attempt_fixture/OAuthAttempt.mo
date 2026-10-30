import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";

/// Local-only M1 vector contract.  It deliberately does not contact an OAuth
/// provider, accept a code/token, or create an identity binding.
module {
  public type Provider = { #github; #orcid; #bitbucket; #gitlab };

  public type Attempt = {
    caller : Principal;
    provider : Provider;
    purpose : Text;
    state : Text;
    pkceChallenge : Text;
    redirect : Text;
    expiresAtNs : Int;
  };

  public type Error = {
    #anonymousCaller;
    #unsupportedProvider;
    #invalidInput;
    #callerMismatch;
    #stateMismatch;
    #expired;
  };

  let maxFieldChars = 512;

  func bounded(value : Text) : Bool {
    value.size() > 0 and value.size() <= maxFieldChars;
  };

  public func begin(
    caller : Principal,
    provider : ?Provider,
    purpose : Text,
    state : Text,
    pkceChallenge : Text,
    redirect : Text,
    nowNs : Int,
    expiresAtNs : Int,
  ) : Result.Result<Attempt, Error> {
    if (Principal.isAnonymous(caller)) return #err(#anonymousCaller);
    let ?selectedProvider = provider else return #err(#unsupportedProvider);
    if (
      not bounded(purpose) or not bounded(state) or not bounded(pkceChallenge) or
      not bounded(redirect) or expiresAtNs <= nowNs
    ) return #err(#invalidInput);
    #ok({
      caller;
      provider = selectedProvider;
      purpose;
      state;
      pkceChallenge;
      redirect;
      expiresAtNs;
    });
  };

  public func complete(attempt : Attempt, caller : Principal, state : Text, nowNs : Int) : Result.Result<(), Error> {
    if (Principal.isAnonymous(caller)) return #err(#anonymousCaller);
    if (not Principal.equal(caller, attempt.caller)) return #err(#callerMismatch);
    if (state != attempt.state) return #err(#stateMismatch);
    if (nowNs > attempt.expiresAtNs) return #err(#expired);
    #ok(());
  };
};
