import Archive "PaymentOperationArchiveRecovery";
import Intent "PaymentOperationIntent";
import MutationRecovery "../shared/MutationRecovery";

/// Fixed M1 transition rules for one payment-operation journal.
///
/// This is deliberately a pure contract.  The future persistent treasury
/// actor must retain `Operation` before its fixed storage-authority await and
/// may not begin archive activation (let alone construct chain material)
/// until the storage write is acknowledged by its exact immutable tuple.
module {
  public type Operation = {
    intent : Intent.Intent;
    archive : ?Archive.ArchiveTuple;
    active : Bool;
  };

  public func prepare(input : Intent.Input) : ?Operation {
    switch (Intent.prepare(input)) {
      case null null;
      case (?intent) ?{ intent; archive = null; active = false };
    };
  };

  public func startStorageWrite(operation : Operation) : Operation {
    { operation with intent = Intent.startRemoteWrite(operation.intent) };
  };

  public func reconcileStorage(
    operation : Operation,
    observed : MutationRecovery.RemoteObservation,
  ) : (Operation, MutationRecovery.RecoveryDecision) {
    let (intent, decision) = Intent.reconcile(Intent.lostReply(operation.intent), observed);
    ({ operation with intent }, decision);
  };

  /// Archive activity is strictly downstream of the acknowledged immutable
  /// storage record.  This makes a missing/lost storage reply fail closed and
  /// prevents a pending payment operation from becoming eligible for any
  /// later chain-facing phase.
  public func beginArchive(operation : Operation) : (Operation, Archive.ArchiveDecision) {
    if (operation.intent.phase != #acknowledged) return (operation, #remainPending);
    let tuple : Archive.ArchiveTuple = {
      logicalId = operation.intent.input.logicalId;
      version = operation.intent.input.desiredVersion;
      contentHash = operation.intent.input.contentHash;
    };
    switch (operation.archive) {
      case null ({ operation with archive = ?tuple }, #remainPending);
      case (?existing) {
        if (existing == tuple) (operation, #remainPending) else (operation, #blocked);
      };
    };
  };

  /// A receipt can activate only the retained archive tuple.  The function
  /// accepts no operation input, destination, amount, or transaction bytes,
  /// so recovery cannot substitute fresh payment material after a lost reply.
  public func reconcileArchive(
    operation : Operation,
    receipt : ?Archive.ArchiveTuple,
  ) : (Operation, Archive.ArchiveDecision) {
    let ?expected = operation.archive else return (operation, #remainPending);
    let decision = Archive.decide(expected, receipt);
    switch (decision) {
      case (#acknowledge) ({ operation with active = true }, decision);
      case (_) (operation, decision);
    };
  };
};
