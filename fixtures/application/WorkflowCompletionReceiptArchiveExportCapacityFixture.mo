// Disposable bounded archive-capacity caller. It validates the complete
// batch before its first await and is not a workflow or archive API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Archive "../../canisters/workflow/CompletionReceiptArchiveRecovery";
import Binding "../../canisters/workflow/CompletionReceiptArchiveExportBinding";
import Receipt "../../canisters/workflow/CompletionReceiptIntent";
import Embedded "../../canisters/application/EmbeddedWorkflowCompletionReceiptStore";

shared ({ caller = installer }) persistent actor class (operator : Principal, sinkId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  let maxBindings : Nat = 32;
  let sink : actor { retain : shared Binding.Binding -> async Archive.ArchiveTuple; count : shared () -> async Nat } = actor (Principal.toText(sinkId));
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(Principal.fromActor(this), null);
  var collectionInitialized = false;
  transient let receiptStore = switch (if (collectionInitialized) Embedded.reopen(stableStore) else Embedded.create(stableStore)) {
    case (?store) store;
    case null Runtime.trap("unable to open fixed synthetic workflow receipt collection");
  };
  collectionInitialized := true;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func prepareBatch(inputs : [Receipt.Input]) : ?[Binding.Binding] {
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

  public shared ({ caller }) func retainBatch(inputs : [Receipt.Input]) : async [Archive.ArchiveTuple] {
    onlyOperator(caller);
    let ?bindings = prepareBatch(inputs) else throw Error.reject("invalid synthetic workflow archive capacity batch");
    var receipts : [Archive.ArchiveTuple] = [];
    for (index in bindings.keys()) {
      let binding = bindings[index];
      switch (Embedded.write(receiptStore, inputs[index])) {
        case (#acknowledged) {};
        case (#blocked) { throw Error.reject("invalid synthetic workflow archive capacity receipt") };
        case (#conflict) { throw Error.reject("synthetic workflow archive capacity receipt conflict") };
        case (#storageError) { throw Error.reject("synthetic workflow archive capacity receipt storage error") };
      };
      let receipt = await sink.retain(binding);
      if (receipt != binding.tuple) throw Error.reject("synthetic workflow archive capacity receipt changed");
      receipts := Array.append(receipts, [receipt]);
    };
    receipts;
  };

  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await sink.count() };
};
