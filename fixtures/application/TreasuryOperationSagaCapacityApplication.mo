// Disposable bounded application-outbox capacity fixture. It validates the
// complete batch before its first await; it is not an application API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Saga "../../canisters/application/TreasuryOperationSaga";
import Outbox "../../canisters/application/EmbeddedTreasuryOperationOutboxStore";

shared ({ caller = installer }) persistent actor class (operator : Principal, treasuryId : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(operator);
  let maxIntents : Nat = 32;
  let treasury : actor { submit : shared Saga.Input -> async Receipt; count : shared () -> async Nat } = actor (Principal.toText(treasuryId));
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(Principal.fromActor(this), null);
  var outboxCollectionInitialized = false;
  transient let outboxStore = switch (if (outboxCollectionInitialized) {
    Outbox.reopen(stableStore);
  } else {
    Outbox.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic application treasury outbox capacity collection");
  };
  outboxCollectionInitialized := true;

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
      switch (Outbox.write(outboxStore, input)) {
        case (#acknowledged) {};
        case (_) throw Error.reject("synthetic application outbox capacity write failed");
      };
      let receipt = await treasury.submit(input);
      if (receipt.version != input.version or receipt.contentHash != input.contentHash) throw Error.reject("synthetic treasury capacity receipt changed");
      receipts := Array.append(receipts, [receipt]);
    };
    receipts;
  };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await treasury.count() };
};
