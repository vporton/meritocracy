import Principal "mo:base/Principal";

/// Small, pure authorization predicates for future public application
/// methods.  A method must pass its authenticated Candid caller as `caller`;
/// this module never accepts a caller-supplied principal as authentication.
///
/// G2 must still define the production capability and governance model.  This
/// M1 contract is deliberately limited to the invariants that do not depend
/// on that pending decision: anonymous callers fail closed, and a self-scoped
/// action is permitted only for the exact non-anonymous subject principal.
module {
  public type Decision = { #allowed; #anonymous; #forbidden };

  public func authenticated(caller : Principal) : Decision {
    if (Principal.isAnonymous(caller)) #anonymous else #allowed;
  };

  /// Authorizes a resource owned by one caller principal.  The target
  /// principal is resource metadata resolved by the method, never a claim
  /// supplied as authority by the caller.
  public func selfScoped(caller : Principal, resourcePrincipal : Principal) : Decision {
    if (Principal.isAnonymous(caller) or Principal.isAnonymous(resourcePrincipal)) {
      #anonymous;
    } else if (caller == resourcePrincipal) {
      #allowed;
    } else {
      #forbidden;
    };
  };

  /// Authorizes a fixed service-to-service caller chosen by the owning actor.
  /// It is a building block for the later application-to-treasury boundary;
  /// the actor must retain the expected principal as trusted configuration and
  /// bind it to `caller` inside the public method body.
  public func fixedServiceCaller(caller : Principal, expected : Principal) : Decision {
    if (Principal.isAnonymous(caller) or Principal.isAnonymous(expected)) {
      #anonymous;
    } else if (caller == expected) {
      #allowed;
    } else {
      #forbidden;
    };
  };
};
