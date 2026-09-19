// Disposable, synthetic-metadata-only proof of the consolidated application's
// private migration-receipt adapter. This is not the application canister and
// is built only by its isolated M1 PocketIC proof runner.
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/application/EmbeddedMigrationReceiptStore";
import Receipt "../../canisters/archive_router/MigrationReceiptIntent";

persistent actor this {
  // Mirrors the target actor's create/reopen discipline. No fixture method
  // accepts source rows, credentials, a collection name, or an importer
  // capability: it carries only one bounded immutable receipt tuple.
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
    case null Runtime.trap("unable to open fixed synthetic application migration receipt collection");
  };
  collectionInitialized := true;

  public func writeReceipt(input : Receipt.Input) : async Embedded.WriteResult {
    Embedded.write(store, input);
  };
};
