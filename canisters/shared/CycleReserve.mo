/// Fixed M1 cycle-reserve policy for synthetic saga proofs.
///
/// A caller must retain this reserve before beginning a cross-canister
/// mutation attempt. The durable intent is written first, so a low-cycle
/// rejection leaves only an immutable, recoverable retry -- never a partial
/// mutation or an activated record. This is deliberately not a replenishment
/// mechanism and exposes no public configuration surface.
module {
  // One trillion cycles is intentionally far below a production budget. It is
  // only a deterministic proof floor; G2 must replace it with measured,
  // collection-specific operational budgets and alerting.
  public let minimumReserve : Nat = 1_000_000_000_000;

  public type Decision = { #allowed; #lowCycles };

  public func decide(available : Nat) : Decision {
    if (available >= minimumReserve) #allowed else #lowCycles;
  };
}
