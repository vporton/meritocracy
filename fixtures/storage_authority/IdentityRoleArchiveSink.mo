// Disposable archive half of the M1 identity/role activation proof.  It keeps
// only the acknowledgement tuple and deliberately rejects calls until the
// synthetic operator permits it; it never receives an identity payload.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Archive "../../canisters/shared/IdentityRoleArchiveRecovery";

shared ({ caller = installer }) persistent actor class (core : Principal, operator : Principal) = this {
  assert not Principal.isAnonymous(core);
  assert not Principal.isAnonymous(operator);
  assert core != operator;
  var permitted = false;
  // This fixture permits only the four fixed binding/role acknowledgement
  // tuples exercised by the lost-reply and repair/resume branches. It is
  // deliberately bounded and holds no source payload.
  var receipts : [Archive.ArchiveTuple] = [];

  func onlyCore(caller : Principal) { assert caller == core };
  func onlyOperator(caller : Principal) { assert caller == operator };

  // Do not turn the bounded fixture into an archive router: the proof admits
  // exactly its four synthetic operation IDs and no caller-selected archive
  // namespace.
  func allowedLogicalId(logicalId : Text) : Bool {
    logicalId == "principal-binding:v1:synthetic-44" or
    logicalId == "role-assignment:v1:synthetic-44:auditor" or
    logicalId == "principal-binding:v1:synthetic-repair-44" or
    logicalId == "role-assignment:v1:synthetic-repair-44:auditor";
  };

  public shared ({ caller }) func permit() : async () {
    onlyOperator(caller);
    permitted := true;
  };

  /// Test-only availability control. Revoking availability never removes an
  /// existing immutable receipt; it lets the proof distinguish a new archive
  /// call that was never accepted from one whose reply was merely lost.
  public shared ({ caller }) func revoke() : async () {
    onlyOperator(caller);
    permitted := false;
  };

  public shared ({ caller }) func archive(tuple : Archive.ArchiveTuple) : async Archive.ArchiveTuple {
    onlyCore(caller);
    if (not permitted or not Archive.validTuple(tuple) or not allowedLogicalId(tuple.logicalId)) throw Error.reject("synthetic archive unavailable");
    for (stored in receipts.vals()) {
      if (stored.logicalId == tuple.logicalId) {
        if (stored == tuple) return stored else throw Error.reject("synthetic archive conflict");
      };
    };
    if (receipts.size() >= 4) throw Error.reject("synthetic archive receipt limit");
    receipts := Array.append(receipts, [tuple]);
    tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyCore(caller);
    for (stored in receipts.vals()) {
      if (stored.logicalId == logicalId) return ?stored;
    };
    null;
  };
}
