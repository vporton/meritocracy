// Disposable authority half of the M1 core-to-authority lost-reply proof.
// It accepts only its configured synthetic core canister, exposes only the
// fixed principal-binding write/lookup pair, and contains no grant or generic
// CRUD surface.
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/storage_authority/EmbeddedIdentityRoleStore";
import IdentityRole "../../canisters/shared/IdentityRoleRecovery";

shared ({ caller = installer }) persistent actor class (core : Principal) = this {
  assert not Principal.isAnonymous(core);
  assert installer != core;
  var stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(Principal.fromActor(this), null);
  // `create` is valid only on a fresh install.  Reopening on EOP upgrade is
  // essential: an upgrade must retain the immutable record and must not try
  // to recreate (or silently replace) either fixed collection.
  var initialized = false;
  transient let store = switch (if (initialized) Embedded.reopen(stableStore) else Embedded.create(stableStore)) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic collection");
  };
  initialized := true;

  public shared ({ caller }) func writeBinding(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    if (caller != core) return #blocked;
    Embedded.writeBinding(store, input);
  };

  public shared ({ caller }) func lookupBinding(logicalId : Text) : async Embedded.BindingObservation {
    if (caller != core) return #conflict;
    Embedded.lookupBinding(store, logicalId);
  };
}
