// Disposable M1 archive-binding proof for migration receipts. It is neither
// an importer nor an archive service and accepts no source rows or credentials.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Archive "../../canisters/archive_router/MigrationReceiptArchiveRecovery";
import Binding "../../canisters/archive_router/MigrationReceiptArchiveExportBinding";
import Receipt "../../canisters/archive_router/MigrationReceiptIntent";
import Embedded "../../canisters/application/EmbeddedMigrationReceiptStore";
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

  // Use the application's fixed private receipt adapter before an archive
  // binding becomes dispatchable. This fixture still has no importer or
  // source payload: it proves only that an already-valid metadata tuple is
  // durably idempotent across the archive lost-reply boundary.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );
  var collectionInitialized = false;
  transient let receiptStore = switch (
    if (collectionInitialized) Embedded.reopen(stableStore) else Embedded.create(stableStore)
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open fixed synthetic migration receipt collection");
  };
  collectionInitialized := true;

  // The canonical bytes and their derived archive tuple are committed before
  // the only await. A lost reply cannot make a migration receipt active.
  var retained : ?Binding.Binding = null;
  var acknowledged = false;
  // A committed interruption is distinct from an unknown sink reply. Only the
  // fixed repair principal can dispatch this already-retained binding.
  var repairRequired = false;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func onlyRepairOperator(caller : Principal) { assert caller == repairOperator };
  // Proof-only reserve. The binding is durable before this gate, so a
  // depleted fixture cannot begin its synthetic archive dispatch.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };
  func retainReceipt(input : Receipt.Input) {
    switch (Embedded.write(receiptStore, input)) {
      case (#acknowledged) {};
      case (#blocked) { Runtime.trap("invalid synthetic migration archive receipt") };
      case (#conflict) { Runtime.trap("synthetic migration archive receipt conflict") };
      case (#storageError) { Runtime.trap("synthetic migration archive receipt storage error") };
    };
  };

  public shared ({ caller }) func retainThenLoseReply(input : Receipt.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic migration archive receipt");
    retainReceipt(input);
    switch (retained) {
      case null { retained := ?binding; acknowledged := false };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic migration archive binding is immutable once retained");
      };
    };
    if (repairRequired) throw Error.reject("synthetic migration archive repair is required");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic migration archive returned changed receipt");
    throw Error.reject("deliberately lost migration archive reply");
  };

  // There is no replacement input on the unknown-result path. Activation can
  // follow only an exact durable receipt lookup.
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
    if (repairRequired) throw Error.reject("synthetic migration archive repair is required");
    let ?binding = retained else throw Error.reject("missing synthetic migration archive binding");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic migration archive retry receipt changed");
    throw Error.reject("deliberately lost migration archive retry reply");
  };

  // This models a committed interruption before the archive await. It accepts
  // no repair payload, so immutable retained bytes are the only possible send.
  public shared ({ caller }) func retainForOperatorRepair(input : Receipt.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic migration archive receipt");
    retainReceipt(input);
    switch (retained) {
      case null { retained := ?binding; acknowledged := false; repairRequired := true };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic migration archive binding is immutable once retained");
        if (not repairRequired) throw Error.reject("synthetic migration archive receipt is already dispatched");
      };
    };
  };

  public shared ({ caller }) func repairThenLoseReply() : async () {
    onlyRepairOperator(caller);
    if (not repairRequired) throw Error.reject("synthetic migration archive repair is not pending");
    let ?binding = retained else throw Error.reject("missing synthetic migration archive binding");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic migration archive repair receipt changed");
    repairRequired := false;
    throw Error.reject("deliberately lost migration archive repair reply");
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
