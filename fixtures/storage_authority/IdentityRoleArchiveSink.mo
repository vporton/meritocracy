// Disposable archive half of the M1 identity/role activation proof.  It keeps
// only the acknowledgement tuple and deliberately rejects calls until the
// synthetic operator permits it; it never receives an identity payload.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Archive "../../canisters/shared/IdentityRoleArchiveRecovery";

shared ({ caller = installer }) persistent actor class (core : Principal, operator : Principal) = this {
  assert not Principal.isAnonymous(core);
  assert not Principal.isAnonymous(operator);
  assert core != operator;
  var permitted = false;
  var receipt : ?Archive.ArchiveTuple = null;

  func onlyCore(caller : Principal) { assert caller == core };
  func onlyOperator(caller : Principal) { assert caller == operator };

  public shared ({ caller }) func permit() : async () {
    onlyOperator(caller);
    permitted := true;
  };

  public shared ({ caller }) func archive(tuple : Archive.ArchiveTuple) : async Archive.ArchiveTuple {
    onlyCore(caller);
    if (not permitted or not Archive.validTuple(tuple)) throw Error.reject("synthetic archive unavailable");
    switch (receipt) {
      case null { receipt := ?tuple; tuple };
      case (?stored) {
        if (stored == tuple) stored else throw Error.reject("synthetic archive conflict");
      };
    };
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyCore(caller);
    switch (receipt) { case (?stored) { if (stored.logicalId == logicalId) ?stored else null }; case null null };
  };
}
