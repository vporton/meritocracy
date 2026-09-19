// Disposable, synthetic-data-only proof of the consolidated application's
// private workflow-completion receipt adapter. This is not the application
// canister and is built only by its isolated M1 PocketIC proof runner.
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/application/EmbeddedWorkflowCompletionReceiptStore";
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

  public func writeReceipt(input : Receipt.Input) : async Embedded.WriteResult {
    Embedded.write(store, input);
  };
};
