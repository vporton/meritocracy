// This source is copied only into a hash-verified ZenDB v2.0.1 checkout by
// `test-zendb-embedded-storage.sh`. It deliberately imports the *embedded*
// library rather than the rejected RemoteInstance/CanisterDB actor. The probe
// has no application Candid surface, no caller-provided storage operation, and
// no target data. Its purpose is to make the exact in-process stable-store
// type/check boundary reproducible before an adapter is added to the
// storage-authority canister.
import Principal "mo:core@2.4/Principal";
import ZenDB "../src/EmbeddedInstance";

shared ({ caller = installer }) persistent actor class () = this {
  assert not Principal.isAnonymous(installer);

  // The embedded store, unlike the remote ZenDB actor, is private actor state.
  // A future adapter must keep this state behind the storage authority's fixed
  // Motoko policy and must prove bounded, owner-specific operations before it
  // becomes authoritative.
  var stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );

  // Referencing the database constructor forces the exact candidate's
  // in-process API and stable-store representation through compilation. The
  // value is intentionally discarded: this fixture creates no database,
  // collection, document, index, grant, or public CRUD method.
  ignore ZenDB.launchDefaultDB(stableStore);
};
