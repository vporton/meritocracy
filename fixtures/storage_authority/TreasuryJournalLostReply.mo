// Disposable M1 proof fixture only. It owns one immutable journal intent,
// never a balance, asset account, destination, signer, or chain operation.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import CycleReserve "../../canisters/shared/CycleReserve";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Embedded "../../canisters/storage_authority/EmbeddedTreasuryJournalStore";
import Intent "../../canisters/treasury/TreasuryJournalIntent";

shared ({ caller = installer }) persistent actor class (
  operator : Principal,
  authorityId : Principal,
) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;

  let authority : actor {
    writeTreasuryJournalEntry : shared Intent.Input -> async Embedded.WriteResult;
    lookupTreasuryJournalEntry : shared Text -> async Embedded.Observation;
  } = actor (Principal.toText(authorityId));

  // One bounded durable pre-await journal slot. Recovery methods have no
  // posting input, so an unknown reply can never be repaired with a new debit,
  // credit, amount, account, operation ID, or sequence number.
  var journal : ?Intent.Intent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  // The immutable tuple is retained before this proof-only reserve guard.
  // A depleted fixture cannot start a write and can later retry only this
  // exact tuple after test-only replenishment. It is not a capacity policy.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };

  // Make the durable-journal-to-write boundary explicit. This fixed lookup
  // cannot create a journal record while the reserve guard rejects a write.
  func checkpointJournal(logicalId : Text) : async () {
    ignore await authority.lookupTreasuryJournalEntry(logicalId);
  };

  func observation(value : Embedded.Observation) : ?MutationRecovery.RemoteObservation {
    switch (value) {
      case (#absent) ?#absent;
      case (#present(tuple)) ?#present(tuple);
      case (_) null;
    };
  };

  public shared ({ caller }) func writeThenLoseReply(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic treasury journal entry");
    journal := ?Intent.startRemoteWrite(prepared);
    await checkpointJournal(input.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryJournalEntry(input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic treasury journal write failed");
    };
    journal := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic treasury journal reply");
  };

  // Models a trap after durable intent retention but before any authority call.
  public shared ({ caller }) func journalThenTrapBeforeAwait(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic treasury journal entry");
    journal := ?Intent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted before treasury journal authority call");
  };

  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?remote = observation(await authority.lookupTreasuryJournalEntry(saved.input.logicalId)) else return #blocked;
    let (updated, decision) = Intent.reconcile(Intent.lostReply(saved), remote);
    journal := ?updated;
    decision;
  };

  // The retry has no input and resubmits only the immutable durable tuple.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic treasury journal");
    if (saved.phase != #remoteWriteStarted) throw Error.reject("journal is not eligible for identical retry");
    await checkpointJournal(saved.input.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryJournalEntry(saved.input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic treasury journal retry failed");
    };
    journal := ?Intent.lostReply(saved);
    throw Error.reject("deliberately lost synthetic treasury journal retry reply");
  };

  public shared ({ caller }) func repairJournaledEntry() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?remote = observation(await authority.lookupTreasuryJournalEntry(saved.input.logicalId)) else return #blocked;
    switch (Intent.reconcile(Intent.lostReply(saved), remote)) {
      case (updated, #retryIdentical) {
        await checkpointJournal(saved.input.logicalId);
        requireCycleReserve();
        switch (await authority.writeTreasuryJournalEntry(saved.input)) {
          case (#acknowledged) { journal := ?Intent.lostReply(updated); #retryIdentical };
          case (_) #blocked;
        };
      };
      case (updated, decision) { journal := ?updated; decision };
    };
  };
};
