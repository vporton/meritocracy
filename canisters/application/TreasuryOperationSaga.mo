import Blob "mo:base/Blob";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// The application-side half of the one permitted custom-canister boundary.
/// This is a pure M1 transition contract, not a payment API. A future
/// application actor must retain this exact immutable outbox intent before
/// awaiting treasury; recovery accepts only the retained receipt tuple.
module {
  public type Input = { logicalId : Text; version : Nat64; contentHash : Blob };

  public type Intent = {
    input : Input;
    phase : StorageTypes.MutationPhase;
    active : Bool;
  };

  func validLogicalId(value : Text) : Bool {
    if (value.size() == 0 or value.size() > 512) return false;
    for (character in value.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return false;
    };
    true;
  };

  func validHash(value : Blob) : Bool { Blob.toArray(value).size() == 32 };

  /// This receipt identity is intentionally all cross-canister recovery
  /// material held here: no operation, amount, destination, or chain data.
  public func prepare(input : Input) : ?Intent {
    if (not validLogicalId(input.logicalId) or not validHash(input.contentHash)) return null;
    ?{ input; phase = #prepared; active = false };
  };

  public func startTreasuryCall(intent : Intent) : Intent {
    if (intent.phase != #prepared) return intent;
    { intent with phase = #remoteWriteStarted };
  };

  /// An interrupted or discarded reply has no success interpretation.
  public func lostReply(intent : Intent) : Intent {
    if (intent.phase != #remoteWriteStarted) return intent;
    { intent with phase = #reconciling };
  };

  /// Absence permits only an identical retry. A competing or malformed tuple
  /// fails closed; only an exact retained receipt activates this side.
  public func reconcile(
    intent : Intent,
    observed : MutationRecovery.RemoteObservation,
  ) : (Intent, MutationRecovery.RecoveryDecision) {
    let decision = MutationRecovery.resolve(
      intent.input.version,
      intent.input.contentHash,
      { version = null; contentHash = null },
      observed,
    );
    let phase = MutationRecovery.phaseAfterRecovery(decision);
    ({ intent with phase; active = decision == #acknowledge }, decision);
  };
};
