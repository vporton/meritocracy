import Array "mo:base/Array";
import MutationRecovery "../shared/MutationRecovery";
import Journal "TreasuryJournalIntent";
import Set "TreasuryJournalBalancedSet";

/// Durable-state transition contract for one bounded immutable journal set.
///
/// A future persistent treasury actor stores `State` before its first
/// authority await.  This module deliberately has no actor, persistence, or
/// authority call: it prevents the actor's recovery code from replacing a
/// posting, activating a partial set, or retrying with caller-supplied input.
module {
  public type Phase = { #pending; #active; #conflict; #blocked };

  public type State = {
    set : Set.Input;
    entries : [Journal.Intent];
    /// True only after this exact posting had an explicit `#absent` recovery
    /// observation. A sent-but-unobserved posting is never retryable.
    retryAllowed : [Bool];
    phase : Phase;
  };

  func sameEntry(input : Journal.Input, retained : Journal.Input) : Bool {
    input.logicalId == retained.logicalId and
    input.journalSequence == retained.journalSequence and
    input.operationId == retained.operationId and
    input.accountId == retained.accountId and
    input.assetId == retained.assetId and
    input.direction == retained.direction and
    input.amountBaseUnits == retained.amountBaseUnits and
    input.assetDecimals == retained.assetDecimals and
    input.desiredVersion == retained.desiredVersion and
    input.contentHash == retained.contentHash;
  };

  /// This is the sole construction path. It fixes the set and every posting
  /// before any remote write; callers cannot later append, reorder, or swap a
  /// member while recovering an unknown result.
  public func prepare(input : Set.Input) : ?State {
    if (not Set.valid(input)) return null;
    var intents : [Journal.Intent] = [];
    for (entry in input.entries.vals()) {
      let ?intent = Journal.prepare(entry) else return null;
      intents := Array.append<Journal.Intent>(intents, [intent]);
    };
    ?{ set = input; entries = intents; retryAllowed = Array.tabulate<Bool>(intents.size(), func(_) { false }); phase = #pending };
  };

  func mutableAt(state : State, index : Nat) : Bool {
    state.phase == #pending and index < state.entries.size() and state.retryAllowed.size() == state.entries.size();
  };

  func replaceIntent(state : State, index : Nat, replacement : Journal.Intent) : State {
    let entries = Array.tabulate<Journal.Intent>(state.entries.size(), func(current) {
      if (current == index) replacement else state.entries[current];
    });
    { state with entries };
  };

  func replaceRetryPermission(state : State, index : Nat, allowed : Bool) : State {
    let retryAllowed = Array.tabulate<Bool>(state.retryAllowed.size(), func(current) {
      if (current == index) allowed else state.retryAllowed[current];
    });
    { state with retryAllowed };
  };

  /// Marks exactly one already-retained posting as sent. No posting data is
  /// accepted here, so a retry can only use the persisted immutable tuple.
  public func startWrite(state : State, index : Nat) : State {
    if (not mutableAt(state, index)) return state;
    let current = state.entries[index];
    switch (current.phase) {
      case (#prepared) {
        replaceRetryPermission(replaceIntent(state, index, Journal.startRemoteWrite(current)), index, false);
      };
      case (#remoteWriteStarted) state;
      case (_) state;
    };
  };

  public func lostReply(state : State, index : Nat) : State {
    if (not mutableAt(state, index)) return state;
    let current = state.entries[index];
    if (current.phase != #remoteWriteStarted) return state;
    replaceRetryPermission(replaceIntent(state, index, Journal.lostReply(current)), index, false);
  };

  func acknowledgedObservation(intent : Journal.Intent) : MutationRecovery.RemoteObservation {
    if (intent.phase == #acknowledged) {
      #present({ version = intent.input.desiredVersion; contentHash = intent.input.contentHash });
    } else {
      #absent;
    };
  };

  func activationPhase(state : State) : Phase {
    switch (Set.reconcile(state.set, Array.map<Journal.Intent, MutationRecovery.RemoteObservation>(state.entries, acknowledgedObservation))) {
      case (#activate) #active;
      case (#conflict) #conflict;
      case (#blocked) #blocked;
      case (#remainPending) #pending;
    };
  };

  /// Reconciliation consumes only a bounded authority observation. An absent
  /// record leaves the stored tuple retryable; a conflicting record makes the
  /// entire set fail closed. The set activates only after every member's exact
  /// version/hash acknowledgement is retained in state.
  public func reconcile(
    state : State,
    index : Nat,
    observed : MutationRecovery.RemoteObservation,
  ) : (State, MutationRecovery.RecoveryDecision) {
    if (not mutableAt(state, index)) return (state, #blocked);
    let current = state.entries[index];
    if (current.phase != #remoteWriteStarted and current.phase != #reconciling) return (state, #blocked);
    let (recovered, decision) = Journal.reconcile(Journal.lostReply(current), observed);
    let updated = replaceRetryPermission(
      replaceIntent(state, index, recovered),
      index,
      decision == #retryIdentical,
    );
    switch (decision) {
      case (#conflict) ({ updated with phase = #conflict }, decision);
      case (#blocked) ({ updated with phase = #blocked }, decision);
      case (_) {
        let phase = activationPhase(updated);
        ({ updated with phase }, decision);
      };
    };
  };

  /// The caller can obtain a retry only for the retained entry after a proven
  /// absent result. It must resend those exact bytes; any supplied substitute
  /// input is rejected by `matchesRetained` before a future actor can call the
  /// authority again.
  public func retryInput(state : State, index : Nat) : ?Journal.Input {
    if (not mutableAt(state, index)) return null;
    let intent = state.entries[index];
    if (intent.phase == #remoteWriteStarted and state.retryAllowed[index]) ?intent.input else null;
  };

  public func matchesRetained(state : State, index : Nat, candidate : Journal.Input) : Bool {
    index < state.entries.size() and sameEntry(candidate, state.entries[index].input);
  };
};
