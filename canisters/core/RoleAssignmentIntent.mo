import IdentityRole "../shared/IdentityRoleRecovery";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// Fixed-core role-assignment intent transitions. This mirrors the binding
/// contract without accepting a caller-selected collection or recovery tuple.
/// The persistent caller must journal the validated immutable input before its
/// one fixed authority await; a retry can use only that journaled input.
module {
  public type RoleIntent = {
    input : IdentityRole.RoleAssignmentInput;
    phase : StorageTypes.MutationPhase;
  };

  public func prepare(input : IdentityRole.RoleAssignmentInput) : ?RoleIntent {
    if (not IdentityRole.validRoleAssignment(input)) return null;
    ?{ input; phase = #prepared };
  };

  public func startRemoteWrite(intent : RoleIntent) : RoleIntent {
    { intent with phase = #remoteWriteStarted };
  };

  public func lostReply(intent : RoleIntent) : RoleIntent {
    { intent with phase = #reconciling };
  };

  public func reconcile(
    intent : RoleIntent,
    observed : MutationRecovery.RemoteObservation,
  ) : (RoleIntent, MutationRecovery.RecoveryDecision) {
    let decision = MutationRecovery.resolve(
      intent.input.desiredVersion,
      intent.input.contentHash,
      { version = null; contentHash = null },
      observed,
    );
    ({ intent with phase = MutationRecovery.phaseAfterRecovery(decision) }, decision);
  };
}
