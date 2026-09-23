// Disposable M1 archive-binding proof for workflow-completion receipts. This
// is not a workflow implementation and accepts no result, task, or provider
// payload.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Archive "../../canisters/workflow/CompletionReceiptArchiveRecovery";
import Binding "../../canisters/workflow/CompletionReceiptArchiveExportBinding";
import Receipt "../../canisters/workflow/CompletionReceiptIntent";
import Embedded "../../canisters/application/EmbeddedWorkflowCompletionReceiptStore";
import CycleReserve "../../canisters/shared/CycleReserve";

shared ({ caller = installer }) persistent actor class (operator : Principal, repairOperator : Principal, sinkId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  assert not Principal.isAnonymous(repairOperator);
  assert operator != repairOperator;
  let sink : actor {
    retain : shared Binding.Binding -> async Archive.ArchiveTuple;
    lookup : shared Text -> async ?Archive.ArchiveTuple;
    count : shared () -> async Nat;
  } = actor (Principal.toText(sinkId));

  // Open only the consolidated application's fixed private receipt adapter.
  // This fixture has no workflow result or public application API: it proves
  // that an already-valid immutable receipt is durably idempotent before its
  // derived archive binding can be dispatched.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );
  var collectionInitialized = false;
  transient let receiptStore = switch (
    if (collectionInitialized) Embedded.reopen(stableStore) else Embedded.create(stableStore)
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open fixed synthetic workflow receipt collection");
  };
  collectionInitialized := true;

  // The canonical bytes and SHA-256 receipt tuple are committed before the
  // only await. A lost reply therefore cannot activate a completion receipt.
  var retained : ?Binding.Binding = null;
  var acknowledged = false;
  // An interruption is deliberately distinct from an unknown sink reply.
  // Ordinary retries must not turn this state into an archive dispatch.
  var repairRequired = false;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func onlyRepairOperator(caller : Principal) { assert caller == repairOperator };
  // Proof-only reserve: the immutable canonical binding is durable before
  // this check, so a depleted fixture cannot make an archive dispatch.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };
  func retainReceipt(input : Receipt.Input) {
    switch (Embedded.write(receiptStore, input)) {
      case (#acknowledged) {};
      case (#blocked) { Runtime.trap("invalid synthetic workflow archive receipt") };
      case (#conflict) { Runtime.trap("synthetic workflow archive receipt conflict") };
      case (#storageError) { Runtime.trap("synthetic workflow archive receipt storage error") };
    };
  };

  public shared ({ caller }) func retainThenLoseReply(input : Receipt.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic workflow archive receipt");
    retainReceipt(input);
    switch (retained) {
      case null { retained := ?binding; acknowledged := false };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic workflow archive binding is immutable once retained");
      };
    };
    if (repairRequired) throw Error.reject("synthetic workflow archive repair is required");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic workflow archive returned changed receipt");
    throw Error.reject("deliberately lost workflow archive reply");
  };

  // No replacement receipt, bytes, or hash can enter the unknown-result path.
  public shared ({ caller }) func reconcile() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    if (repairRequired) return #blocked;
    let ?binding = retained else return #blocked;
    let decision = Archive.decide(binding.tuple, await sink.lookup(binding.tuple.logicalId));
    if (decision == #acknowledge) acknowledged := true;
    decision;
  };

  public shared ({ caller }) func retryThenLoseReply() : async () {
    onlyOperator(caller);
    if (repairRequired) throw Error.reject("synthetic workflow archive repair is required");
    let ?binding = retained else throw Error.reject("missing synthetic workflow archive binding");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic workflow archive retry receipt changed");
    throw Error.reject("deliberately lost workflow archive retry reply");
  };

  // This models a committed interruption before the archive await. It accepts
  // no repair payload: only the exact durable binding may later be dispatched.
  public shared ({ caller }) func retainForOperatorRepair(input : Receipt.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic workflow archive receipt");
    retainReceipt(input);
    switch (retained) {
      case null { retained := ?binding; acknowledged := false; repairRequired := true };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic workflow archive binding is immutable once retained");
        if (not repairRequired) throw Error.reject("synthetic workflow archive receipt is already dispatched");
      };
    };
  };

  public shared ({ caller }) func repairThenLoseReply() : async () {
    onlyRepairOperator(caller);
    if (not repairRequired) throw Error.reject("synthetic workflow archive repair is not pending");
    let ?binding = retained else throw Error.reject("missing synthetic workflow archive binding");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic workflow archive repair receipt changed");
    repairRequired := false;
    throw Error.reject("deliberately lost workflow archive repair reply");
  };

  public shared ({ caller }) func reconcileRepair() : async Archive.ArchiveDecision {
    onlyRepairOperator(caller);
    if (not repairRequired) return #blocked;
    let ?binding = retained else return #blocked;
    let decision = Archive.decide(binding.tuple, await sink.lookup(binding.tuple.logicalId));
    if (decision == #acknowledge) {
      acknowledged := true;
      repairRequired := false;
    };
    decision;
  };

  public shared ({ caller }) func isAcknowledged() : async Bool { onlyOperator(caller); acknowledged };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await sink.count() };
};
