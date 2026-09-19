import Archive "TreasuryJournalArchiveRecovery";
import Binding "TreasuryJournalArchiveExportBinding";
import BalancedSet "TreasuryJournalBalancedSet";

/// Durable transition rules for the canonical export of one immutable balanced
/// journal set.  The returned state is intended to be retained before an
/// archive await: it contains the derived bytes and their exact receipt tuple,
/// never caller-supplied archive material or a mutable journal projection.
module {
  public type Phase = { #prepared; #archiveStarted; #pending; #acknowledged; #blocked };

  public type State = {
    binding : Binding.Binding;
    phase : Phase;
  };

  /// Derives and fixes the only archive tuple/byte pair for this set and
  /// version.  A future actor must journal this complete result before its
  /// first archive call.
  public func prepare(input : BalancedSet.Input, version : Nat64) : ?State {
    let ?binding = Binding.prepare(input, version) else return null;
    ?{ binding; phase = #prepared };
  };

  /// Re-checks the canonical source before any dispatch or retry.  This makes
  /// a corrupted durable byte/hash pair fail closed rather than permitting an
  /// archive call with a replacement payload.
  public func startArchive(input : BalancedSet.Input, state : State) : State {
    if (not Binding.matches(input, state.binding)) {
      return { state with phase = #blocked };
    };
    switch (state.phase) {
      case (#prepared or #pending) { { state with phase = #archiveStarted } };
      case (_) state;
    };
  };

  public func lostReply(state : State) : State {
    if (state.phase == #archiveStarted) { { state with phase = #pending } } else state;
  };

  /// An acknowledgement is only an exact receipt for the retained binding.
  /// It neither activates nor deletes the balanced journal set.
  public func reconcile(input : BalancedSet.Input, state : State, receipt : ?Archive.ArchiveTuple) : State {
    if (not Binding.matches(input, state.binding)) {
      return { state with phase = #blocked };
    };
    if (state.phase != #archiveStarted and state.phase != #pending) return state;
    switch (Archive.decide(state.binding.tuple, receipt)) {
      case (#acknowledge) { { state with phase = #acknowledged } };
      case (#remainPending) { { state with phase = #pending } };
      case (#blocked) { { state with phase = #blocked } };
    };
  };

  /// The retry is tuple/bytes-free: the caller can obtain only the already
  /// retained derived binding, and only after an unknown result.
  public func retryBinding(input : BalancedSet.Input, state : State) : ?Binding.Binding {
    if (state.phase == #pending and Binding.matches(input, state.binding)) ?state.binding else null;
  };
};
