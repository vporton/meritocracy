// Disposable treasury half of the M1 payment-operation recovery proof. It is
// deliberately separate from the target treasury canister: no custody,
// signer, destination address, chain call, or public project interface is
// enabled by this fixture.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Embedded "../../canisters/storage_authority/EmbeddedPaymentOperationStore";
import Intent "../../canisters/treasury/PaymentOperationIntent";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import CycleReserve "../../canisters/shared/CycleReserve";

shared ({ caller = installer }) persistent actor class (
  operator : Principal,
  authorityId : Principal,
  archiveId : Principal,
) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;

  let authority : actor {
    writeTreasuryPaymentOperation : shared Intent.Input -> async Embedded.WriteResult;
    lookupTreasuryPaymentOperation : shared Text -> async Embedded.Observation;
  } = actor (Principal.toText(authorityId));
  let archive : actor {
    archive : shared Archive.ArchiveTuple -> async Archive.ArchiveTuple;
    lookup : shared Text -> async ?Archive.ArchiveTuple;
  } = actor (Principal.toText(archiveId));

  // This is the durable pre-await journal. The fixture has one bounded saga
  // slot and never accepts replacement operation material during recovery.
  var journal : ?Intent.Intent = null;
  var archiveTuple : ?Archive.ArchiveTuple = null;
  var active = false;

  func onlyOperator(caller : Principal) { assert caller == operator };

  // The durable journal is assigned before this guard. A depleted fixture
  // therefore cannot begin a payment-operation authority write, and its
  // only possible recovery remains the retained exact tuple after test-only
  // replenishment. This proof floor is not a production capacity policy.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };

  // Preserve an explicit durable message boundary between journalling and a
  // guarded write. The lookup is fixed, read-only, and tuple-free; it cannot
  // create a payment operation while the reserve guard rejects the write.
  func checkpointJournal(logicalId : Text) : async () {
    ignore await authority.lookupTreasuryPaymentOperation(logicalId);
  };

  func remoteObservation(observation : Embedded.Observation) : ?MutationRecovery.RemoteObservation {
    switch (observation) {
      case (#absent) ?#absent;
      case (#present(value)) ?#present(value);
      case (_) null;
    };
  };

  /// Starts one immutable operation, persists it before the authority await,
  /// then deliberately rejects after the authority acknowledges. The caller
  /// must treat the result as unknown and use `reconcileLostReply`.
  public shared ({ caller }) func writeThenLoseReply(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic payment operation");
    archiveTuple := null;
    active := false;
    journal := ?Intent.startRemoteWrite(prepared);
    await checkpointJournal(input.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryPaymentOperation(input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic payment-operation write failed");
    };
    journal := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic payment-operation reply");
  };

  /// Models interruption after a validated immutable intent is durable, but
  /// before any authority call is issued. Recovery must first observe
  /// `#absent`; it may then resend only this retained tuple through the
  /// no-input retry method below. In particular, no fresh operation,
  /// obligation, asset, amount, destination, or transaction material can be
  /// introduced after the interruption.
  public shared ({ caller }) func journalThenTrapBeforeAwait(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic payment operation");
    archiveTuple := null;
    active := false;
    journal := ?Intent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted before synthetic payment-operation authority call");
  };

  /// Recovery has no input: it can inspect only the durable tuple and a
  /// fixed authority lookup. A different operation ID/version/hash cannot be
  /// substituted after an unknown result.
  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?observed = remoteObservation(await authority.lookupTreasuryPaymentOperation(saved.input.logicalId)) else return #blocked;
    let (updated, decision) = Intent.reconcile(Intent.lostReply(saved), observed);
    journal := ?updated;
    decision;
  };

  /// An absent observation permits one identical re-delivery from the durable
  /// journal. This method intentionally takes no operation, amount, asset, or
  /// destination input and again loses its reply for reconciliation.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic payment-operation journal");
    if (saved.phase != #remoteWriteStarted) throw Error.reject("synthetic journal is not eligible for identical retry");
    await checkpointJournal(saved.input.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryPaymentOperation(saved.input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic payment-operation retry failed");
    };
    journal := ?Intent.lostReply(saved);
    throw Error.reject("deliberately lost synthetic payment-operation retry reply");
  };

  /// Operator repair has no operation input.  It is deliberately useful only
  /// after an interruption: an absent fixed lookup may re-send the one
  /// retained tuple, while a present record is reconciled by exact
  /// version/hash.  In neither branch can repair mint replacement payment or
  /// transaction material.
  public shared ({ caller }) func repairJournaledOperation() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?observed = remoteObservation(await authority.lookupTreasuryPaymentOperation(saved.input.logicalId)) else return #blocked;
    switch (Intent.reconcile(Intent.lostReply(saved), observed)) {
      case (updated, #retryIdentical) {
        await checkpointJournal(saved.input.logicalId);
        requireCycleReserve();
        switch (await authority.writeTreasuryPaymentOperation(saved.input)) {
          case (#acknowledged) {};
          case (_) return #blocked;
        };
        journal := ?Intent.lostReply(updated);
        #retryIdentical;
      };
      case (updated, decision) {
        journal := ?updated;
        decision;
      };
    };
  };

  /// Archive activation is downstream of an exact storage acknowledgement.
  /// The sink receives only the immutable tuple, never amount, destination,
  /// asset, obligation, signing, or chain material. Its successful reply is
  /// deliberately lost so recovery must use its fixed tuple-only lookup.
  public shared ({ caller }) func archiveThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic payment-operation journal");
    if (saved.phase != #acknowledged) throw Error.reject("payment operation is not storage-acknowledged");
    let tuple : Archive.ArchiveTuple = {
      logicalId = saved.input.logicalId;
      version = saved.input.desiredVersion;
      contentHash = saved.input.contentHash;
    };
    archiveTuple := ?tuple;
    let receipt = await archive.archive(tuple);
    if (Archive.decide(tuple, ?receipt) != #acknowledge) throw Error.reject("synthetic payment-operation archive mismatch");
    throw Error.reject("deliberately lost synthetic payment-operation archive reply");
  };

  public shared ({ caller }) func reconcileArchive() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?expected = archiveTuple else return #blocked;
    let decision = Archive.decide(expected, await archive.lookup(expected.logicalId));
    if (decision == #acknowledge) active := true;
    decision;
  };

  /// Archive repair is likewise tuple-only.  It cannot activate from archive
  /// availability, an operator decision, or a fresh payment input.
  public shared ({ caller }) func repairArchiveResume() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?expected = archiveTuple else return #blocked;
    let decision = Archive.decide(expected, await archive.lookup(expected.logicalId));
    if (decision == #acknowledge) active := true;
    decision;
  };

  public shared ({ caller }) func isActive() : async Bool {
    onlyOperator(caller);
    active;
  };
};
