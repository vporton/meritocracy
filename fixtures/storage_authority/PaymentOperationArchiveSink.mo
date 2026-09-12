// Disposable archive half of the M1 payment-operation activation proof. It
// retains only an acknowledgement tuple; no payment amount, destination,
// signing material, transaction, or chain receipt crosses this boundary.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";

shared ({ caller = installer }) persistent actor class (treasury : Principal, operator : Principal) = this {
  assert not Principal.isAnonymous(treasury);
  assert not Principal.isAnonymous(operator);
  assert treasury != operator;
  var permitted = false;
  var receipts : [Archive.ArchiveTuple] = [];

  func onlyTreasury(caller : Principal) { assert caller == treasury };
  func onlyOperator(caller : Principal) { assert caller == operator };
  func allowed(logicalId : Text) : Bool {
    logicalId == "payment-operation:v1:synthetic-1" or
    logicalId == "payment-operation:v1:synthetic-interrupted-44";
  };

  public shared ({ caller }) func permit() : async () { onlyOperator(caller); permitted := true };
  public shared ({ caller }) func revoke() : async () { onlyOperator(caller); permitted := false };

  public shared ({ caller }) func archive(tuple : Archive.ArchiveTuple) : async Archive.ArchiveTuple {
    onlyTreasury(caller);
    if (not permitted or not Archive.validTuple(tuple) or not allowed(tuple.logicalId)) {
      throw Error.reject("synthetic payment-operation archive unavailable");
    };
    for (stored in receipts.vals()) {
      if (stored.logicalId == tuple.logicalId) {
        if (stored == tuple) return stored else throw Error.reject("synthetic payment-operation archive conflict");
      };
    };
    if (receipts.size() >= 2) throw Error.reject("synthetic payment-operation archive receipt limit");
    receipts := Array.append(receipts, [tuple]);
    tuple;
  };

  public shared ({ caller }) func lookup(logicalId : Text) : async ?Archive.ArchiveTuple {
    onlyTreasury(caller);
    for (stored in receipts.vals()) { if (stored.logicalId == logicalId) return ?stored };
    null;
  };
};
