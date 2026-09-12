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
    writeCorePrincipalBinding : shared IdentityRole.PrincipalBindingInput -> async Embedded.WriteResult;
    lookupCorePrincipalBinding : shared Text -> async Embedded.BindingObservation;
  } = actor (Principal.toText(authorityId));
  var intent : ?Intent.BindingIntent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  public shared ({ caller }) func writeThenLoseReply(input : IdentityRole.PrincipalBindingInput) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic binding");
    // This assignment is the durable pre-await journal boundary.
    intent := ?Intent.startRemoteWrite(prepared);
    let result = await authority.writeCorePrincipalBinding(input);
    switch (result) { case (#acknowledged) {}; case (_) { throw Error.reject("synthetic write failed") } };
    // Trap after the successful remote write so this call's reply is unknown
    // to the caller; the persisted pre-await journal must be reconciled.
    intent := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic authority reply");
  };

  /// Models a trap after the immutable intent reaches durable actor state but
  /// before the cross-canister call is even issued. Recovery must observe an
  /// absent fixed record and retry precisely this journaled input; it may not
  /// accept a new caller-supplied version, hash, or logical ID.
  public shared ({ caller }) func journalThenTrapBeforeAwait(input : IdentityRole.PrincipalBindingInput) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic binding");
    intent := ?Intent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted before synthetic authority call");
  };

  /// This has no input by design: following an `#retryIdentical` decision,
  /// only the durable pre-await intent may be redelivered to the authority.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?journal = intent else throw Error.reject("missing synthetic journal");
    if (journal.phase != #remoteWriteStarted) {
      throw Error.reject("synthetic journal is not eligible for identical retry");
    };
    let result = await authority.writeCorePrincipalBinding(journal.input);
    switch (result) { case (#acknowledged) {}; case (_) { throw Error.reject("synthetic retry failed") } };
    intent := ?Intent.lostReply(journal);
    throw Error.reject("deliberately lost synthetic authority retry reply");
  };

  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?journal = intent else return #blocked;
    let observation = await authority.lookupCorePrincipalBinding(journal.input.logicalId);
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
