// Disposable core half of the M1 lost-reply proof. It journals before await,
// deliberately traps after the authority has written, then reconciles through
// the fixed lookup using only the retained immutable input.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Intent "../../canisters/core/IdentityRoleIntent";
import Embedded "../../canisters/storage_authority/EmbeddedIdentityRoleStore";
import IdentityRole "../../canisters/shared/IdentityRoleRecovery";
import MutationRecovery "../../canisters/shared/MutationRecovery";

shared ({ caller = installer }) persistent actor class (operator : Principal, authorityId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;
  let authority : actor {
    writeBinding : shared IdentityRole.PrincipalBindingInput -> async Embedded.WriteResult;
    lookupBinding : shared Text -> async Embedded.BindingObservation;
  } = actor (Principal.toText(authorityId));
  var intent : ?Intent.BindingIntent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  public shared ({ caller }) func writeThenLoseReply(input : IdentityRole.PrincipalBindingInput) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic binding");
    // This assignment is the durable pre-await journal boundary.
    intent := ?Intent.startRemoteWrite(prepared);
    let result = await authority.writeBinding(input);
    switch (result) { case (#acknowledged) {}; case (_) { throw Error.reject("synthetic write failed") } };
    // Trap after the successful remote write so this call's reply is unknown
    // to the caller; the persisted pre-await journal must be reconciled.
    intent := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic authority reply");
  };

  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?journal = intent else return #blocked;
    let observation = await authority.lookupBinding(journal.input.logicalId);
    let remote : MutationRecovery.RemoteObservation = switch (observation) {
      case (#absent) #absent;
      case (#present(value)) #present(value);
      case (_) return #blocked;
    };
    let (updated, decision) = Intent.reconcile(Intent.lostReply(journal), remote);
    intent := ?updated;
    decision;
  };
}
