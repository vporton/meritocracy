// Disposable M1 workflow receipt recovery fixture. It is not a workflow and
// accepts no task input, provider response, or result payload.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import Embedded "../../canisters/storage_authority/EmbeddedWorkflowCompletionReceiptStore";
import Intent "../../canisters/workflow/CompletionReceiptIntent";
import CycleReserve "../../canisters/shared/CycleReserve";
import MutationRecovery "../../canisters/shared/MutationRecovery";

shared ({ caller = installer }) persistent actor class (operator : Principal, authorityId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;
  let authority : actor {
    writeWorkflowCompletionReceipt : shared Intent.Input -> async Embedded.WriteResult;
    lookupWorkflowCompletionReceipt : shared Text -> async Embedded.Observation;
  } = actor (Principal.toText(authorityId));
  var journal : ?Intent.Intent = null;
  func onlyOperator(caller : Principal) { assert caller == operator };
  func reserve() { assert CycleReserve.decide(Cycles.balance()) == #allowed };
  // This await commits the journal but cannot mutate a receipt.
  func checkpoint(id : Text) : async () { ignore await authority.lookupWorkflowCompletionReceipt(id) };
  func observe(value : Embedded.Observation) : ?MutationRecovery.RemoteObservation {
    switch (value) { case (#absent) ?#absent; case (#present(tuple)) ?#present(tuple); case (_) null };
  };

  public shared ({ caller }) func writeThenLoseReply(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic workflow receipt");
    journal := ?Intent.startRemoteWrite(prepared);
    await checkpoint(input.logicalId);
    reserve();
    switch (await authority.writeWorkflowCompletionReceipt(input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic workflow receipt write failed");
    };
    journal := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic workflow receipt reply");
  };

  public shared ({ caller }) func journalThenTrapBeforeAwait(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic workflow receipt");
    journal := ?Intent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted before synthetic workflow receipt authority call");
  };

  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?seen = observe(await authority.lookupWorkflowCompletionReceipt(saved.input.logicalId)) else return #blocked;
    let (updated, decision) = Intent.reconcile(Intent.lostReply(saved), seen);
    journal := ?updated;
    decision;
  };

  // No input: recovery cannot exchange the immutable tuple for a new one.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic workflow receipt journal");
    if (saved.phase != #remoteWriteStarted) throw Error.reject("synthetic workflow receipt journal is not retryable");
    await checkpoint(saved.input.logicalId);
    reserve();
    switch (await authority.writeWorkflowCompletionReceipt(saved.input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic workflow receipt retry failed");
    };
    journal := ?Intent.lostReply(saved);
    throw Error.reject("deliberately lost synthetic workflow receipt retry reply");
  };

  // Repair has no receipt input and may resend only after #absent.
  public shared ({ caller }) func repairJournaledReceipt() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?seen = observe(await authority.lookupWorkflowCompletionReceipt(saved.input.logicalId)) else return #blocked;
    switch (Intent.reconcile(Intent.lostReply(saved), seen)) {
      case (updated, #retryIdentical) {
        await checkpoint(saved.input.logicalId);
        reserve();
        switch (await authority.writeWorkflowCompletionReceipt(saved.input)) {
          case (#acknowledged) { journal := ?Intent.lostReply(updated); #retryIdentical };
          case (_) #blocked;
        };
      };
      case (updated, decision) { journal := ?updated; decision };
    };
  };
};
