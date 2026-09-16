import Blob "mo:base/Blob";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// M1's immutable, single-entry treasury-journal recovery contract.
///
/// This is deliberately pure.  It neither changes a balance nor calls the
/// storage authority, a ledger, or a chain.  A future treasury actor must
/// durably retain this exact input before its fixed journal write and use the
/// retained sequence/version/hash tuple to reconcile an unknown reply.  The
/// balancing set and account policy remain a later, separately journaled
/// bounded saga; this contract makes it impossible to substitute one posting
/// for another while recovering a single immutable entry.
module {
  public type Direction = { #debit; #credit };

  public type Input = {
    logicalId : Text;
    journalSequence : Nat64;
    operationId : Text;
    accountId : Text;
    assetId : Text;
    direction : Direction;
    amountBaseUnits : Nat;
    assetDecimals : Nat8;
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

  /// A journal entry is immutable, positive, and integer-denominated.  It
  /// carries an explicit asset decimal count but never accepts an address,
  /// signed transaction, external receipt, or floating-point amount.
  public func valid(input : Input) : Bool {
    boundedText(input.logicalId, 512) and input.journalSequence > 0 and boundedText(input.operationId, 512) and boundedText(input.accountId, 256) and boundedText(input.assetId, 128) and input.amountBaseUnits > 0 and input.assetDecimals <= 38 and hash(input.contentHash);
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

  /// Sequence is part of the durable input and is intentionally not replaced
  /// after an unknown result.  `MutationRecovery` accepts only the retained
  /// desired version and content hash; an absent record permits only this
  /// exact durable input to be retried by the caller.
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
