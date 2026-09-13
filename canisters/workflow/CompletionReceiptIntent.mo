import Blob "mo:base/Blob";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// M1's fixed workflow-completion receipt recovery contract.
///
/// This module is deliberately pure: it neither runs a workflow nor calls the
/// storage authority. A future workflow actor must first retain this immutable
/// intent, then use the exact logical-ID/version/hash tuple to reconcile an
/// unknown `workflow_completion_receipt_v1` reply. It cannot turn a duplicate
/// delivery into a new completion receipt.
module {
  public type Input = {
    logicalId : Text;
    cycleId : Text;
    operationName : Text;
    desiredVersion : Nat64;
    contentHash : Blob;
  };

  public type Intent = {
    input : Input;
    phase : StorageTypes.MutationPhase;
  };

  func boundedText(value : Text, maximum : Nat) : Bool {
    if (value.size() == 0 or value.size() > maximum) return false;
    for (character in value.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return false;
    };
    true;
  };

  func hash(value : Blob) : Bool { Blob.toArray(value).size() == 32 };

  /// `cycleId` and `operationName` form the collection's immutable unique
  /// completion identity. Their payload, caller, provider response, and any
  /// task inputs remain outside this receipt contract.
  public func valid(input : Input) : Bool {
    boundedText(input.logicalId, 512) and
    boundedText(input.cycleId, 256) and
    boundedText(input.operationName, 128) and
    hash(input.contentHash);
  };

  public func prepare(input : Input) : ?Intent {
    if (not valid(input)) return null;
    ?{ input; phase = #prepared };
  };

  public func startRemoteWrite(intent : Intent) : Intent {
    { intent with phase = #remoteWriteStarted };
  };

  public func lostReply(intent : Intent) : Intent {
    { intent with phase = #reconciling };
  };

  /// Only an exact retained version/hash acknowledges a completion. Absence
  /// permits redelivery of the same journaled intent; every other observation
  /// fails closed rather than replaying an operation under replacement input.
  public func reconcile(
    intent : Intent,
    observed : MutationRecovery.RemoteObservation,
  ) : (Intent, MutationRecovery.RecoveryDecision) {
    let decision = MutationRecovery.resolve(
      intent.input.desiredVersion,
      intent.input.contentHash,
      { version = null; contentHash = null },
      observed,
    );
    ({ intent with phase = MutationRecovery.phaseAfterRecovery(decision) }, decision);
  };
};
