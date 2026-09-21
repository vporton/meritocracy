// Disposable proof of the application half of the sole application-to-treasury
// boundary. It is not an application canister or a payment interface.
import Error "mo:base/Error";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Saga "../../canisters/application/TreasuryOperationSaga";

shared ({ caller = installer }) persistent actor class (operator : Principal, treasuryId : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(operator);
  let treasury : actor {
    submit : shared Saga.Input -> async Receipt;
    lookup : shared Text -> async ?Receipt;
    count : shared () -> async Nat;
  } = actor (Principal.toText(treasuryId));

  var retained : ?Saga.Intent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  // The intent is retained before the outbound await. A subsequent delivery
  // supplies no replacement input, so it can only use this exact tuple.
  public shared ({ caller }) func retainThenLoseReply(input : Saga.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic application treasury tuple");
    switch (retained) {
      case null { retained := ?prepared };
      case (?saved) { if (saved.input != prepared.input) throw Error.reject("synthetic outbox intent is immutable") };
    };
    let ?saved = retained else throw Error.reject("missing synthetic outbox intent");
    retained := ?Saga.startTreasuryCall(saved);
    let receipt = await treasury.submit(saved.input);
    if (receipt.version != saved.input.version or receipt.contentHash != saved.input.contentHash) {
      throw Error.reject("synthetic treasury returned changed receipt");
    };
    throw Error.reject("deliberately lost synthetic treasury reply");
  };

  public shared ({ caller }) func reconcile() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = retained else return #blocked;
    let (updated, decision) = Saga.reconcile(Saga.lostReply(saved), switch (await treasury.lookup(saved.input.logicalId)) {
      case null #absent;
      case (?receipt) #present(receipt);
    });
    retained := ?updated;
    decision;
  };

  public shared ({ caller }) func retryThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = retained else throw Error.reject("missing synthetic outbox intent");
    let receipt = await treasury.submit(saved.input);
    if (receipt.version != saved.input.version or receipt.contentHash != saved.input.contentHash) {
      throw Error.reject("synthetic treasury retry receipt changed");
    };
    throw Error.reject("deliberately lost synthetic treasury retry reply");
  };

  public shared ({ caller }) func isActive() : async Bool {
    onlyOperator(caller);
    switch (retained) { case (?saved) saved.active; case null false };
  };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await treasury.count() };
};
