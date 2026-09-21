// Disposable bounded treasury-inbox capacity fixture. It receives only the
// application boundary tuple; no payment, asset, address, or chain data.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Saga "../../canisters/application/TreasuryOperationSaga";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(application);
  let maxReceipts : Nat = 32;
  var retained : [Saga.Input] = [];
  func onlyApplication(caller : Principal) { assert caller == application };

  public shared ({ caller }) func submit(input : Saga.Input) : async Receipt {
    onlyApplication(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic treasury inbox capacity tuple");
    for (saved in retained.vals()) {
      if (saved.logicalId == prepared.input.logicalId) {
        if (saved == prepared.input) return { version = saved.version; contentHash = saved.contentHash }
        else throw Error.reject("synthetic treasury inbox capacity conflict");
      };
    };
    if (retained.size() >= maxReceipts) throw Error.reject("synthetic treasury inbox capacity limit");
    retained := Array.append(retained, [prepared.input]);
    { version = prepared.input.version; contentHash = prepared.input.contentHash };
  };
  public shared ({ caller }) func count() : async Nat { onlyApplication(caller); retained.size() };
};
