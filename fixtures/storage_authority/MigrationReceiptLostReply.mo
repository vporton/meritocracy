// Disposable M1 importer half of the fixed migration-receipt recovery proof.
// This is not the target importer: it has no PostgreSQL connection, source
// projection, credential, chunk decoder, or public project interface.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Embedded "../../canisters/storage_authority/EmbeddedMigrationReceiptStore";
import Intent "../../canisters/archive_router/MigrationReceiptIntent";
import MutationRecovery "../../canisters/shared/MutationRecovery";

shared ({ caller = installer }) persistent actor class (
  operator : Principal,
  authorityId : Principal,
) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;

  let authority : actor {
    writeMigrationReceipt : shared Intent.Input -> async Embedded.WriteResult;
    lookupMigrationReceipt : shared Text -> async Embedded.Observation;
  } = actor (Principal.toText(authorityId));

  // The one-slot fixture journal is deliberately persistent and set before
  // every remote call. Recovery never accepts fresh input.
  var journal : ?Intent.Intent = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  func observation(value : Embedded.Observation) : ?MutationRecovery.RemoteObservation {
    switch (value) {
      case (#absent) ?#absent;
      case (#present(tuple)) ?#present(tuple);
      case (_) null;
    };
  };

  public shared ({ caller }) func writeThenLoseReply(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic receipt");
    journal := ?Intent.startRemoteWrite(prepared);
    switch (await authority.writeMigrationReceipt(input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic receipt write failed");
    };
    journal := ?Intent.lostReply(Intent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic receipt reply");
  };

  public shared ({ caller }) func journalThenTrapBeforeAwait(input : Intent.Input) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic receipt");
    journal := ?Intent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted before synthetic receipt authority call");
  };

  public shared ({ caller }) func reconcileLostReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?saved = journal else return #blocked;
    let ?seen = observation(await authority.lookupMigrationReceipt(saved.input.logicalId)) else return #blocked;
    let (updated, decision) = Intent.reconcile(Intent.lostReply(saved), seen);
    journal := ?updated;
    decision;
  };

  // No caller input means a repair can only replay the immutable persisted
  // receipt tuple after absence. A changed migration/table/chunk/hash can
  // never be inserted as a recovery attempt.
  public shared ({ caller }) func retryJournaledWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = journal else throw Error.reject("missing synthetic receipt journal");
    if (saved.phase != #remoteWriteStarted) throw Error.reject("synthetic receipt journal is not retryable");
    switch (await authority.writeMigrationReceipt(saved.input)) {
      case (#acknowledged) {};
      case (_) throw Error.reject("synthetic receipt retry failed");
    };
    journal := ?Intent.lostReply(saved);
    throw Error.reject("deliberately lost synthetic receipt retry reply");
  };
};
