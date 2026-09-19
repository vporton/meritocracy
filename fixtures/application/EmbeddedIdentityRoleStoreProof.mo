// Disposable, synthetic-data-only proof of the consolidated application's
// private identity/role adapter. This is not the application canister and is
// built only by the M1 PocketIC proof runner.
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/application/EmbeddedIdentityRoleStore";
import IdentityRole "../../canisters/shared/IdentityRoleRecovery";

persistent actor this {
  // This mirrors the target actor's install/reopen discipline. The private
  // store has no Candid storage API; the two test-only methods below are
  // limited to this disposable fixture.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );

  var collectionsInitialized = false;
  transient let store = switch (
    if (collectionsInitialized) {
      Embedded.reopen(stableStore);
    } else {
      Embedded.create(stableStore);
    }
  ) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic application collections");
  };
  collectionsInitialized := true;

  public func writeBinding(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    Embedded.writeBinding(store, input);
  };

  public func writeRole(input : IdentityRole.RoleAssignmentInput) : async Embedded.WriteResult {
    Embedded.writeRole(store, input);
  };
};
