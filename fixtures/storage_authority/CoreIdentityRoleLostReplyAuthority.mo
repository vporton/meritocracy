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
  transient let store = switch (Embedded.create(stableStore)) {
    case (?value) value;
    case null Runtime.trap("unable to create fixed synthetic collection");
  };

  public shared ({ caller }) func writeBinding(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    if (caller != core) return #blocked;
    Embedded.writeBinding(store, input);
  };

  public shared ({ caller }) func lookupBinding(logicalId : Text) : async Embedded.BindingObservation {
    if (caller != core) return #conflict;
    Embedded.lookupBinding(store, logicalId);
  };
}
