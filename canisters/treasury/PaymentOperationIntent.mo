import Blob "mo:base/Blob";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// M1's fixed treasury payment-operation recovery contract.
///
/// This is intentionally pure: it neither authorizes a payment nor calls a
/// chain or storage authority. A future treasury actor must persist this exact
/// immutable input before its fixed storage call, and may only reconcile an
/// unknown reply using the retained operation ID, version, and content hash.
/// The destination is represented only by its hash at this boundary.
module {
  public type Input = {
    logicalId : Text;
    operationId : Text;
    obligationId : Text;
    assetId : Text;
    amountBaseUnits : Nat;
    assetDecimals : Nat8;
    destinationHash : Blob;
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

  /// The zero amount is intentionally invalid: a payment-operation ID must
  /// describe one concrete non-zero value transfer candidate. No floating
  /// point amount or raw destination is accepted by this contract.
  public func valid(input : Input) : Bool {
    boundedText(input.logicalId, 512) and
    boundedText(input.operationId, 512) and
    boundedText(input.obligationId, 512) and
    boundedText(input.assetId, 128) and
    input.amountBaseUnits > 0 and
    input.assetDecimals <= 38 and
    hash(input.destinationHash) and
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

  /// An absent operation permits only an identical retry. Any changed version
  /// or hash is a conflict; callers must never mint a replacement operation ID
  /// after an unknown result.
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
