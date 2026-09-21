// Disposable, synthetic-data-only proof of the consolidated application's
// private workflow-completion receipt adapter. This is not the application
// canister and is built only by its isolated M1 PocketIC proof runner.
import Principal "mo:base/Principal";
import Cycles "mo:base/ExperimentalCycles";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/application/EmbeddedWorkflowCompletionReceiptStore";
import CycleReserve "../../canisters/shared/CycleReserve";
import Receipt "../../canisters/workflow/CompletionReceiptIntent";

persistent actor this {
  // Mirrors the target actor's create/reopen discipline. In-process writes
  // have no inter-canister await: a caller that loses an ingress reply must
  // redeliver the same immutable tuple, rather than recover through a
  // rollback-inducing trap after a local write.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );

  var collectionInitialized = false;
  transient let store = switch (
    if (collectionInitialized) {
      Embedded.reopen(stableStore);
    } else {
      Embedded.create(stableStore);
    }
  ) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic application workflow receipt collection");
  };
  collectionInitialized := true;

  // Fixture-only durable intent for the synthetic low-cycle boundary.  The
  // receipt is retained and validated before the reserve check; recovery has
  // no input, so a later replenishment cannot substitute a different tuple.
  var pendingReceipt : ?Receipt.Input = null;
  // The fixed principal below is the disposable PocketIC installer used only
  // by this fixture. It models a separate operator-repair boundary without
  // selecting, granting, or exposing a target application capability.
  let repairPrincipal = Principal.fromText("xs6im-qieam");
  var repairRequired = false;

  func writePendingReceipt() : Embedded.WriteResult {
    let ?input = pendingReceipt else return #blocked;
    if (Cycles.balance() < CycleReserve.minimumReserve) return #blocked;
    let result = Embedded.write(store, input);
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { pendingReceipt := null };
      case (#blocked) {};
    };
    result;
  };

  public func writeReceipt(input : Receipt.Input) : async Embedded.WriteResult {
    Embedded.write(store, input);
  };

  public func retainReceiptThenWrite(input : Receipt.Input) : async Embedded.WriteResult {
    if (pendingReceipt != null or not Receipt.valid(input)) return #blocked;
    pendingReceipt := ?input;
    writePendingReceipt();
  };

  // Models an interruption after immutable intent retention and before a
  // private write. It deliberately has no input-bearing resume path.
  public func retainReceiptForOperatorRepair(input : Receipt.Input) : async Embedded.WriteResult {
    if (pendingReceipt != null or not Receipt.valid(input)) return #blocked;
    pendingReceipt := ?input;
    repairRequired := true;
    #blocked;
  };

  public func retryRetainedReceipt() : async Embedded.WriteResult {
    if (repairRequired) return #blocked;
    writePendingReceipt();
  };

  public shared ({ caller }) func repairRetainedReceipt() : async Embedded.WriteResult {
    if (caller != repairPrincipal or not repairRequired) return #blocked;
    let result = writePendingReceipt();
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { repairRequired := false };
      case (#blocked) {};
    };
    result;
  };
};
