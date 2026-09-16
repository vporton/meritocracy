// Disposable M1 proof fixture only. It owns one immutable journal intent,
// never a balance, asset account, destination, signer, or chain operation.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import CycleReserve "../../canisters/shared/CycleReserve";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Embedded "../../canisters/storage_authority/EmbeddedTreasuryJournalStore";
import Intent "../../canisters/treasury/TreasuryJournalIntent";
import BalancedSet "../../canisters/treasury/TreasuryJournalBalancedSet";
import BalancedSaga "../../canisters/treasury/TreasuryJournalBalancedSetSaga";

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

  // A separate bounded, durable double-entry journal.  This fixture is the
  // sole synthetic holder of it: after preparation no ingress can replace,
  // append, reorder, or supply a posting.  It is not a balance projection.
  var balancedJournal : ?BalancedSaga.State = null;

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

  public shared ({ caller }) func prepareBalancedSet(input : BalancedSet.Input) : async () {
    onlyOperator(caller);
    let ?prepared = BalancedSaga.prepare(input) else throw Error.reject("invalid synthetic balanced journal set");
    switch (balancedJournal) {
      case null { balancedJournal := ?prepared };
      case (?_) throw Error.reject("synthetic balanced journal already retained");
    };
  };

  // The complete set and this member's remote-write phase are retained before
  // this deliberate interruption. Recovery paths accept no posting bytes.
  public shared ({ caller }) func journalBalancedEntryThenTrapBeforeAwait(index : Nat) : async () {
    onlyOperator(caller);
    let ?saved = balancedJournal else throw Error.reject("missing synthetic balanced journal");
    let started = BalancedSaga.startWrite(saved, index);
    if (started == saved) throw Error.reject("balanced entry is not writable");
    balancedJournal := ?started;
    throw Error.reject("deliberately interrupted before balanced journal authority call");
  };

  // The index is bounded by the retained set (2--16 entries); there is no
  // entry argument. Every actual authority write therefore uses only bytes
  // journaled by `prepareBalancedSet` before this await.
  public shared ({ caller }) func writeBalancedEntryThenLoseReply(index : Nat) : async () {
    onlyOperator(caller);
    let ?saved = balancedJournal else throw Error.reject("missing synthetic balanced journal");
    let started = BalancedSaga.startWrite(saved, index);
    if (started == saved) throw Error.reject("balanced entry is not writable");
    let retained = started.entries[index].input;
    balancedJournal := ?started;
    await checkpointJournal(retained.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryJournalEntry(retained)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic balanced journal write failed");
    };
    balancedJournal := ?BalancedSaga.lostReply(started, index);
    throw Error.reject("deliberately lost synthetic balanced journal reply");
  };

  public shared ({ caller }) func reconcileBalancedEntry(index : Nat) : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = balancedJournal else return #blocked;
    if (index >= saved.entries.size()) return #blocked;
    let ?remote = observation(await authority.lookupTreasuryJournalEntry(saved.entries[index].input.logicalId)) else return #blocked;
    let (updated, decision) = BalancedSaga.reconcile(saved, index, remote);
    balancedJournal := ?updated;
    decision;
  };

  public shared ({ caller }) func retryBalancedEntryThenLoseReply(index : Nat) : async () {
    onlyOperator(caller);
    let ?saved = balancedJournal else throw Error.reject("missing synthetic balanced journal");
    let ?retained = BalancedSaga.retryInput(saved, index) else throw Error.reject("balanced entry is not eligible for identical retry");
    let started = BalancedSaga.startWrite(saved, index);
    balancedJournal := ?started;
    await checkpointJournal(retained.logicalId);
    requireCycleReserve();
    switch (await authority.writeTreasuryJournalEntry(retained)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic balanced journal retry failed");
    };
    balancedJournal := ?BalancedSaga.lostReply(started, index);
    throw Error.reject("deliberately lost synthetic balanced journal retry reply");
  };

  // Operator repair is index-only: after an exact absent observation it can
  // submit only the already retained immutable tuple, never replacement input.
  public shared ({ caller }) func repairBalancedEntry(index : Nat) : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = balancedJournal else return #blocked;
    if (index >= saved.entries.size()) return #blocked;
    let ?remote = observation(await authority.lookupTreasuryJournalEntry(saved.entries[index].input.logicalId)) else return #blocked;
    let (reconciled, decision) = BalancedSaga.reconcile(saved, index, remote);
    switch (decision) {
      case (#retryIdentical) {
        let ?retained = BalancedSaga.retryInput(reconciled, index) else return #blocked;
        let started = BalancedSaga.startWrite(reconciled, index);
        balancedJournal := ?started;
        await checkpointJournal(retained.logicalId);
        requireCycleReserve();
        switch (await authority.writeTreasuryJournalEntry(retained)) {
          case (#acknowledged) {
            balancedJournal := ?BalancedSaga.lostReply(started, index);
            #retryIdentical;
          };
          case (_) { balancedJournal := ?reconciled; #blocked };
        };
      };
      case (_) { balancedJournal := ?reconciled; decision };
    };
  };

  public shared ({ caller }) func balancedPhase() : async BalancedSaga.Phase {
    onlyOperator(caller);
    switch (balancedJournal) { case (?saved) saved.phase; case null #blocked };
  };
};
