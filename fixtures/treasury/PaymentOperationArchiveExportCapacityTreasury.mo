// Disposable bounded archive-capacity caller. It validates the complete
// bounded batch before its first await and has no target treasury API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../../canisters/treasury/PaymentOperationArchiveExportBinding";
import Embedded "../../canisters/treasury/EmbeddedPaymentOperationStore";
import Operation "../../canisters/treasury/PaymentOperationIntent";

shared ({ caller = installer }) persistent actor class (operator : Principal, sinkId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  let maxBindings : Nat = 32;
  let sink : actor { retain : shared Binding.Binding -> async Archive.ArchiveTuple; count : shared () -> async Nat } = actor (Principal.toText(sinkId));

  // This disposable fixture opens the same private payment-operation adapter
  // as the consolidated treasury. It exposes neither that collection nor a
  // payment operation through Candid.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this), null,
  );
  var collectionInitialized = false;
  transient let paymentOperationStore = switch (if (collectionInitialized) {
    Embedded.reopen(stableStore);
  } else {
    Embedded.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic payment-operation collection");
  };
  collectionInitialized := true;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func prepareBatch(inputs : [Operation.Input]) : ?[Binding.Binding] {
    if (inputs.size() == 0 or inputs.size() > maxBindings) return null;
    var bindings : [Binding.Binding] = [];
    for (input in inputs.vals()) {
      let ?binding = Binding.prepare(input) else return null;
      for (saved in bindings.vals()) {
        if (saved.tuple.logicalId == binding.tuple.logicalId) return null;
      };
      bindings := Array.append(bindings, [binding]);
    };
    ?bindings;
  };

  public shared ({ caller }) func retainBatch(inputs : [Operation.Input]) : async [Archive.ArchiveTuple] {
    onlyOperator(caller);
    let ?bindings = prepareBatch(inputs) else throw Error.reject("invalid synthetic payment-operation archive capacity batch");
    // All batch members are validated before this loop; each immutable
    // operation must then be durably accepted before the first archive await.
    // A conflict or storage error traps the whole message, leaving no partial
    // archive dispatch route.
    for (input in inputs.vals()) {
      switch (Embedded.write(paymentOperationStore, input)) {
        case (#acknowledged) {};
        case (_) throw Error.reject("synthetic private payment-operation write failed");
      };
    };
    var receipts : [Archive.ArchiveTuple] = [];
    for (binding in bindings.vals()) {
      let receipt = await sink.retain(binding);
      if (receipt != binding.tuple) throw Error.reject("synthetic payment-operation archive capacity receipt changed");
      receipts := Array.append(receipts, [receipt]);
    };
    receipts;
  };

  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await sink.count() };
};
