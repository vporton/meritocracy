// Disposable treasury half of the M1 payment-operation recovery proof. It is
// deliberately separate from the target treasury canister: no custody,
// signer, destination address, chain call, or public project interface is
// enabled by this fixture.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Embedded "../../canisters/storage_authority/EmbeddedPaymentOperationStore";
import Intent "../../canisters/treasury/PaymentOperationIntent";

shared ({ caller = installer }) persistent actor class (
  operator : Principal,
  authorityId : Principal,
) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;

  let authority : actor {
    writeTreasuryPaymentOperation : shared Intent.Input -> async Embedded.WriteResult;
    lookupTreasuryPaymentOperation : shared Text -> async Embedded.Observation;
  } = actor (Principal.toText(authorityId));

  // This is the durable pre-await journal. The fixture has one bounded saga
  // slot and never accepts replacement operation material during recovery.
  var journal : ?Intent.Intent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  func remoteObservation(observation : Embedded.Observation) : ?MutationRecovery.RemoteObservation {
    switch (observation) {
      case (#absent) ?#absent;
      case (#present(value)) ?#present(value);
      case (_) null;
    };
  };

  /// Starts one immutable operation, persists it before the authority await,
  /// then deliberately rejects after the authority acknowledges. The caller
  /// must treat the result as unknown and use `reconcileLostReply`.
  public shared ({ caller }) func writeThenLoseReply(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic payment operation");
    journal := ?Intent.startRemoteWrite(prepared);
    switch (await authority.writeTreasuryPaymentOperation(input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic payment-operation write failed");
    };
    journal := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic payment-operation reply");
  };

  /// Recovery has no input: it can inspect only the durable tuple and a
  /// fixed authority lookup. A different operation ID/version/hash cannot be
  /// substituted after an unknown result.
  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?observed = remoteObservation(await authority.lookupTreasuryPaymentOperation(saved.input.logicalId)) else return #blocked;
    let (updated, decision) = Intent.reconcile(Intent.lostReply(saved), observed);
    journal := ?updated;
    decision;
  };

  /// An absent observation permits one identical re-delivery from the durable
  /// journal. This method intentionally takes no operation, amount, asset, or
  /// destination input and again loses its reply for reconciliation.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic payment-operation journal");
    if (saved.phase != #remoteWriteStarted) throw Error.reject("synthetic journal is not eligible for identical retry");
    switch (await authority.writeTreasuryPaymentOperation(saved.input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic payment-operation retry failed");
    };
    journal := ?Intent.lostReply(saved);
    throw Error.reject("deliberately lost synthetic payment-operation retry reply");
  };
};
