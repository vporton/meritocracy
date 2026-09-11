import IdentityRole "../shared/IdentityRoleRecovery";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// Fixed-core identity-binding intent transitions.  This is deliberately a
/// small, pure contract: the persistent core fixture owns the actual journal
/// and invokes the storage authority only after `prepare` has returned an
/// immutable intent.  No recovery path accepts fresh caller input.
module {
  public type BindingIntent = {
    input : IdentityRole.PrincipalBindingInput;
    phase : StorageTypes.MutationPhase;
  };

  public func prepare(input : IdentityRole.PrincipalBindingInput) : ?BindingIntent {
    if (not IdentityRole.validPrincipalBinding(input)) return null;
    ?{ input; phase = #prepared };
  };

  public func startRemoteWrite(intent : BindingIntent) : BindingIntent {
    { intent with phase = #remoteWriteStarted };
  };

  /// A reply that was not durably processed is never interpreted as a failed
  /// write. The core must enter reconciliation with the original bytes,
  /// logical ID, version, and hash still held in its journal.
  public func lostReply(intent : BindingIntent) : BindingIntent {
    { intent with phase = #reconciling };
  };

  public func reconcile(
    intent : BindingIntent,
    observed : MutationRecovery.RemoteObservation,
  ) : (BindingIntent, MutationRecovery.RecoveryDecision) {
    let decision = MutationRecovery.resolve(
      intent.input.desiredVersion,
      intent.input.contentHash,
      { version = null; contentHash = null },
      observed,
    );
    ({ intent with phase = MutationRecovery.phaseAfterRecovery(decision) }, decision);
  };
}
