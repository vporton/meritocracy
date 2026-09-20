// Disposable, synthetic-data-only proof of the consolidated application's
// private identity/role adapter. This is not the application canister and is
// built only by the M1 PocketIC proof runner.
import Principal "mo:base/Principal";
import Cycles "mo:base/ExperimentalCycles";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/application/EmbeddedIdentityRoleStore";
import CycleReserve "../../canisters/shared/CycleReserve";
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

  // These are fixture-only durable intents.  They model a local private
  // collection mutation that is retained before the fixed synthetic reserve
  // is checked.  Recovery accepts no replacement input, so replenishment can
  // never turn a depleted attempt into a changed binding or role assignment.
  var pendingBinding : ?IdentityRole.PrincipalBindingInput = null;
  var pendingRole : ?IdentityRole.RoleAssignmentInput = null;

  func writePendingBinding() : Embedded.WriteResult {
    let ?input = pendingBinding else return #blocked;
    if (Cycles.balance() < CycleReserve.minimumReserve) return #blocked;
    let result = Embedded.writeBinding(store, input);
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { pendingBinding := null };
      case (#blocked) {};
    };
    result;
  };

  func writePendingRole() : Embedded.WriteResult {
    let ?input = pendingRole else return #blocked;
    if (Cycles.balance() < CycleReserve.minimumReserve) return #blocked;
    let result = Embedded.writeRole(store, input);
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { pendingRole := null };
      case (#blocked) {};
    };
    result;
  };

  public func writeBinding(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    Embedded.writeBinding(store, input);
  };

  public func writeRole(input : IdentityRole.RoleAssignmentInput) : async Embedded.WriteResult {
    Embedded.writeRole(store, input);
  };

  public func retainBindingThenWrite(input : IdentityRole.PrincipalBindingInput) : async Embedded.WriteResult {
    if (pendingBinding != null or not IdentityRole.validPrincipalBinding(input)) return #blocked;
    pendingBinding := ?input;
    writePendingBinding();
  };

  public func retryRetainedBinding() : async Embedded.WriteResult {
    writePendingBinding();
  };

  public func retainRoleThenWrite(input : IdentityRole.RoleAssignmentInput) : async Embedded.WriteResult {
    if (pendingRole != null or not IdentityRole.validRoleAssignment(input)) return #blocked;
    pendingRole := ?input;
    writePendingRole();
  };

  public func retryRetainedRole() : async Embedded.WriteResult {
    writePendingRole();
  };
};
