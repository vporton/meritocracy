// Disposable, synthetic-data-only execution fixture for the M1 embedded
// identity/role adapter. This actor is never a project canister and is built
// solely into an isolated PocketIC Wasm by its proof runner.
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/storage_authority/EmbeddedIdentityRoleStore";
import IdentityRole "../../canisters/shared/IdentityRoleRecovery";

persistent actor this {
  // The adapter owns exactly these two fixed collections. No generic
  // collection, query, document, or grant method is present in this fixture.
  var stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );
  transient let store = switch (Embedded.create(stableStore)) {
    case (?value) value;
    case null Runtime.trap("unable to create fixed synthetic collections");
  };

  public func writeBinding(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    Embedded.writeBinding(store, input);
  };

  public func writeRole(input : IdentityRole.RoleAssignmentInput) : async Embedded.WriteResult {
    Embedded.writeRole(store, input);
  };
};
