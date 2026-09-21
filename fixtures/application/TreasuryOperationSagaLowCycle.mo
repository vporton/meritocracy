// Disposable low-cycle proof for the sole application-to-treasury tuple
// boundary.  It is not an application actor or a payment interface.
import Blob "mo:base/Blob";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import CycleReserve "../../canisters/shared/CycleReserve";
import Saga "../../canisters/application/TreasuryOperationSaga";

shared ({ caller = installer }) persistent actor class (operator : Principal, treasuryId : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(operator);
  let treasury : actor { submit : shared Saga.Input -> async Receipt; count : shared () -> async Nat } = actor (Principal.toText(treasuryId));
  var retained : ?Saga.Intent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func dispatchRetained() : async Bool {
    let ?saved = retained else return false;
    if (Cycles.balance() < CycleReserve.minimumReserve) return false;
    let receipt = await treasury.submit(saved.input);
    if (receipt.version != saved.input.version or receipt.contentHash != saved.input.contentHash) throw Error.reject("changed synthetic treasury receipt");
    retained := ?{ saved with phase = #acknowledged; active = true };
    true;
  };

  // The intent is durable before checking cycles.  Once retained, no method
  // accepts a replacement tuple; retry takes no input after replenishment.
  public shared ({ caller }) func retainThenTry(input : Saga.Input) : async Bool {
    onlyOperator(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic application treasury tuple");
    switch (retained) { case null { retained := ?prepared }; case (?saved) { if (saved.input != prepared.input) throw Error.reject("immutable synthetic outbox intent") } };
    await dispatchRetained();
  };
  public shared ({ caller }) func retryRetained() : async Bool { onlyOperator(caller); await dispatchRetained() };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await treasury.count() };
};
