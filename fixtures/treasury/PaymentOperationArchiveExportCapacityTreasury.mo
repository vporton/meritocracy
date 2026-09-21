// Disposable bounded archive-capacity caller. It validates the complete
// bounded batch before its first await and has no target treasury API.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../../canisters/treasury/PaymentOperationArchiveExportBinding";
import Operation "../../canisters/treasury/PaymentOperationIntent";

shared ({ caller = installer }) persistent actor class (operator : Principal, sinkId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  let maxBindings : Nat = 32;
  let sink : actor { retain : shared Binding.Binding -> async Archive.ArchiveTuple; count : shared () -> async Nat } = actor (Principal.toText(sinkId));

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
