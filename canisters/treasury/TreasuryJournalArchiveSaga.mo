import Archive "TreasuryJournalArchiveRecovery";

/// Durable-state transition contract for archiving one immutable balanced
/// journal set. A future persistent actor retains this state before its first
/// archive await. The state intentionally contains only the archival receipt
/// tuple; it cannot represent a balance, posting, account, asset, destination,
/// signer, transaction, or chain result.
module {
  public type Phase = { #prepared; #archiveStarted; #pending; #acknowledged; #blocked };

  public type State = {
    tuple : Archive.ArchiveTuple;
    phase : Phase;
  };

  /// The sole construction path fixes the tuple before any archive call.
  public func prepare(tuple : Archive.ArchiveTuple) : ?State {
    if (not Archive.validTuple(tuple)) return null;
    ?{ tuple; phase = #prepared };
  };

  /// The durable owner may start only the already-retained archive operation.
  /// No caller-provided replacement tuple is accepted after `prepare`.
  public func startArchive(state : State) : State {
    switch (state.phase) {
      case (#prepared) { { state with phase = #archiveStarted } };
      case (#pending) { { state with phase = #archiveStarted } };
      case (_) state;
    };
  };

  /// An unknown reply never acknowledges the archive. It remains pending for
  /// exact receipt reconciliation or an identical tuple-only retry.
  public func lostReply(state : State) : State {
    if (state.phase == #archiveStarted) { { state with phase = #pending } } else state;
  };

  /// A receipt acknowledges only the retained tuple. Competing/missing
  /// receipts remain pending; malformed tuples block recovery fail-closed.
  public func reconcile(state : State, receipt : ?Archive.ArchiveTuple) : State {
    if (state.phase != #archiveStarted and state.phase != #pending) return state;
    switch (Archive.decide(state.tuple, receipt)) {
      case (#acknowledge) { { state with phase = #acknowledged } };
      case (#remainPending) { { state with phase = #pending } };
      case (#blocked) { { state with phase = #blocked } };
    };
  };

  /// A retry is authorized only after an unknown result and only with the
  /// exact immutable tuple retained in durable state.
  public func retryTuple(state : State) : ?Archive.ArchiveTuple {
    if (state.phase == #pending) ?state.tuple else null;
  };

  public func matchesRetained(state : State, candidate : Archive.ArchiveTuple) : Bool {
    state.tuple.logicalId == candidate.logicalId and
    state.tuple.version == candidate.version and
    state.tuple.contentHash == candidate.contentHash;
  };
};
