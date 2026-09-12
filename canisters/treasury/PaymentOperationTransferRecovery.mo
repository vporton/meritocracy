import Archive "PaymentOperationArchiveRecovery";

/// Fixed M1 rules for reconciling a valueless downstream transfer dispatch.
///
/// A production adapter will have additional chain-specific evidence, but it
/// must retain this immutable operation tuple before submitting anything. An
/// ambiguous submit is never permission to construct replacement transaction
/// material: only the downstream idempotency record for this exact tuple can
/// acknowledge it. This module has no actor, chain call, signing material, or
/// value-bearing field.
module {
  public type Decision = { #acknowledge; #remainPending; #blocked };

  public func decide(
    expected : Archive.ArchiveTuple,
    receipt : ?Archive.ArchiveTuple,
  ) : Decision {
    switch (Archive.decide(expected, receipt)) {
      case (#acknowledge) #acknowledge;
      case (#remainPending) #remainPending;
      case (#blocked) #blocked;
    };
  };
};
