import MutationRecovery "../shared/MutationRecovery";
import Journal "TreasuryJournalIntent";

/// Pure M1 activation rules for one small, immutable double-entry journal set.
///
/// The set is deliberately not a balance projection and has no persistence or
/// cross-canister call. A future treasury saga must durably retain this exact
/// set before writing its fixed entries, and may treat it as active only after
/// every retained entry is acknowledged by its own exact version/hash tuple.
/// A partial or conflicting result therefore cannot silently change a balance
/// or make one side of a posting authoritative.
module {
  public type Input = {
    logicalId : Text;
    entries : [Journal.Input];
  };

  public type Decision = { #remainPending; #activate; #conflict; #blocked };

  func boundedText(value : Text, maximum : Nat) : Bool {
    if (value.size() == 0 or value.size() > maximum) return false;
    for (character in value.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return false;
    };
    true;
  };

  /// A set has a deliberately small fixed upper bound. All postings refer to
  /// one operation and one exact asset denomination; journal logical IDs and
  /// append sequences cannot repeat. Debit and credit base-unit totals must
  /// match exactly, without floating point or a mutable balance field.
  public func valid(input : Input) : Bool {
    if (not boundedText(input.logicalId, 512)) return false;
    if (input.entries.size() < 2 or input.entries.size() > 16) return false;

    let first = input.entries[0];
    var debit : Nat = 0;
    var credit : Nat = 0;
    var index : Nat = 0;
    for (entry in input.entries.vals()) {
      if (not Journal.valid(entry)) return false;
      if (entry.operationId != first.operationId or entry.assetId != first.assetId or entry.assetDecimals != first.assetDecimals) return false;
      var previous : Nat = 0;
      while (previous < index) {
        let other = input.entries[previous];
        if (entry.logicalId == other.logicalId or entry.journalSequence == other.journalSequence) return false;
        previous += 1;
      };
      switch (entry.direction) {
        case (#debit) { debit += entry.amountBaseUnits };
        case (#credit) { credit += entry.amountBaseUnits };
      };
      index += 1;
    };
    debit > 0 and credit > 0 and debit == credit;
  };

  /// Each observation is positionally bound to the corresponding retained
  /// entry. Missing observations leave the whole set pending. Any non-exact
  /// observation fails closed; this never permits an altered entry to replace
  /// the durable set during recovery.
  public func reconcile(input : Input, observations : [MutationRecovery.RemoteObservation]) : Decision {
    if (not valid(input) or observations.size() != input.entries.size()) return #blocked;
    var index : Nat = 0;
    for (entry in input.entries.vals()) {
      let (_, decision) = Journal.reconcile(
        Journal.lostReply(Journal.startRemoteWrite({ input = entry; phase = #prepared })),
        observations[index],
      );
      switch (decision) {
        case (#acknowledge) {};
        case (#retryIdentical) return #remainPending;
        case (#conflict) return #conflict;
        case (#blocked) return #blocked;
      };
      index += 1;
    };
    #activate;
  };
};
