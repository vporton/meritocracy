// Disposable bounded application-outbox capacity fixture. It validates the
// complete batch before its first await; it is not an application API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Saga "../../canisters/application/TreasuryOperationSaga";

shared ({ caller = installer }) persistent actor class (operator : Principal, treasuryId : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(operator);
  let maxIntents : Nat = 32;
  let treasury : actor { submit : shared Saga.Input -> async Receipt; count : shared () -> async Nat } = actor (Principal.toText(treasuryId));

  func onlyOperator(caller : Principal) { assert caller == operator };
  func prepareBatch(inputs : [Saga.Input]) : ?[Saga.Input] {
    if (inputs.size() == 0 or inputs.size() > maxIntents) return null;
    var prepared : [Saga.Input] = [];
    for (input in inputs.vals()) {
      let ?intent = Saga.prepare(input) else return null;
      for (saved in prepared.vals()) { if (saved.logicalId == intent.input.logicalId) return null };
      prepared := Array.append(prepared, [intent.input]);
    };
    ?prepared;
  };

  public shared ({ caller }) func submitBatch(inputs : [Saga.Input]) : async [Receipt] {
    onlyOperator(caller);
    let ?prepared = prepareBatch(inputs) else throw Error.reject("invalid synthetic application outbox capacity batch");
    var receipts : [Receipt] = [];
    for (input in prepared.vals()) {
      let receipt = await treasury.submit(input);
      if (receipt.version != input.version or receipt.contentHash != input.contentHash) throw Error.reject("synthetic treasury capacity receipt changed");
      receipts := Array.append(receipts, [receipt]);
    };
    receipts;
  };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await treasury.count() };
};
