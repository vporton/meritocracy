// Disposable treasury-side inbox for the application saga proof. It retains
// only the immutable recovery tuple; it is neither treasury nor custody code.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Saga "../../canisters/application/TreasuryOperationSaga";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(application);
  var receipts : [(Text, Receipt)] = [];
  func onlyApplication(caller : Principal) { assert caller == application };
  func valid(input : Saga.Input) : Bool { switch (Saga.prepare(input)) { case (?_) true; case null false } };

  public shared ({ caller }) func submit(input : Saga.Input) : async Receipt {
    onlyApplication(caller);
    if (not valid(input)) throw Error.reject("invalid synthetic treasury inbox tuple");
    let receipt : Receipt = { version = input.version; contentHash = input.contentHash };
    for ((logicalId, saved) in receipts.vals()) {
      if (logicalId == input.logicalId) {
        if (saved == receipt) return saved else throw Error.reject("synthetic treasury inbox conflict");
      };
    };
    if (receipts.size() >= 2) throw Error.reject("synthetic treasury inbox limit");
    receipts := Array.append(receipts, [(input.logicalId, receipt)]);
    receipt;
  };
  public shared ({ caller }) func lookup(logicalId : Text) : async ?Receipt {
    onlyApplication(caller);
    for ((savedId, receipt) in receipts.vals()) { if (savedId == logicalId) return ?receipt };
    null;
  };
  public shared ({ caller }) func count() : async Nat { onlyApplication(caller); receipts.size() };
};
