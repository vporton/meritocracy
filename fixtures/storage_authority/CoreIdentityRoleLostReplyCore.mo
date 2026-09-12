// Disposable core half of the M1 lost-reply proof. It journals before await,
// deliberately traps after the authority has written, then reconciles through
// the fixed lookup using only the retained immutable input.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import Intent "../../canisters/core/IdentityRoleIntent";
import RoleIntent "../../canisters/core/RoleAssignmentIntent";
import Embedded "../../canisters/storage_authority/EmbeddedIdentityRoleStore";
import IdentityRole "../../canisters/shared/IdentityRoleRecovery";
import MutationRecovery "../../canisters/shared/MutationRecovery";
import Archive "../../canisters/shared/IdentityRoleArchiveRecovery";
import CycleReserve "../../canisters/shared/CycleReserve";

shared ({ caller = installer }) persistent actor class (operator : Principal, authorityId : Principal, archiveId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;
  let authority : actor {
    writeCorePrincipalBinding : shared IdentityRole.PrincipalBindingInput -> async Embedded.WriteResult;
    lookupCorePrincipalBinding : shared Text -> async Embedded.BindingObservation;
    writeCoreRoleAssignment : shared IdentityRole.RoleAssignmentInput -> async Embedded.WriteResult;
    lookupCoreRoleAssignment : shared Text -> async Embedded.RoleObservation;
  } = actor (Principal.toText(authorityId));
  let archive : actor {
    archive : shared Archive.ArchiveTuple -> async Archive.ArchiveTuple;
    lookup : shared Text -> async ?Archive.ArchiveTuple;
  } = actor (Principal.toText(archiveId));
  var intent : ?Intent.BindingIntent = null;
  var roleIntent : ?RoleIntent.RoleIntent = null;
  var bindingArchive : ?Archive.ArchiveTuple = null;
  var bindingActive = false;
  var roleArchive : ?Archive.ArchiveTuple = null;
  var roleActive = false;

  func onlyOperator(caller : Principal) { assert caller == operator };

  // The journal is durable before this guard runs. A depleted canister must
  // fail closed before beginning a remote mutation, leaving recovery to make
  // the bounded absent/exact-retry decision after cycles are replenished.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };

  // A completed fixed lookup is a durable message boundary for the preceding
  // journal assignment. It is read-only and returns no payload; importantly,
  // it occurs before the authority *write*. A subsequent low-cycle trap can
  // therefore retain the immutable intent without creating any record.
  func checkpointBindingJournal(logicalId : Text) : async () {
    ignore await authority.lookupCorePrincipalBinding(logicalId);
  };

  func checkpointRoleJournal(logicalId : Text) : async () {
    ignore await authority.lookupCoreRoleAssignment(logicalId);
  };

  public shared ({ caller }) func writeThenLoseReply(input : IdentityRole.PrincipalBindingInput) : async () {
    onlyOperator(caller);
    let ?prepared = Intent.prepare(input) else throw Error.reject("invalid synthetic binding");
    // This assignment is the durable pre-await journal boundary.
    intent := ?Intent.startRemoteWrite(prepared);
    await checkpointBindingJournal(input.logicalId);
    requireCycleReserve();
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
    await checkpointBindingJournal(journal.input.logicalId);
    requireCycleReserve();
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

  // Activation is a separate durable saga.  The record stays inactive until a
  // later fixed archive lookup returns the exact tuple; an archive reply is
  // deliberately lost here to model an ambiguous cross-canister result.
  public shared ({ caller }) func archiveBindingThenLoseReply() : async () {
    onlyOperator(caller);
    let ?journal = intent else throw Error.reject("missing synthetic binding journal");
    let tuple : Archive.ArchiveTuple = { logicalId = journal.input.logicalId; version = journal.input.desiredVersion; contentHash = journal.input.contentHash };
    bindingArchive := ?tuple;
    let receipt = await archive.archive(tuple);
    if (Archive.decide(tuple, ?receipt) != #acknowledge) throw Error.reject("synthetic archive mismatch");
    throw Error.reject("deliberately lost synthetic archive reply");
  };

  public shared ({ caller }) func reconcileBindingArchive() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?expected = bindingArchive else return #blocked;
    let decision = Archive.decide(expected, await archive.lookup(expected.logicalId));
    if (decision == #acknowledge) bindingActive := true;
    decision;
  };

  public shared ({ caller }) func isBindingActive() : async Bool {
    onlyOperator(caller);
    bindingActive;
  };

  /// The fixed role path has its own durable journal and fixed authority
  /// calls. It cannot be used to read role data or substitute another tuple
  /// during recovery.
  public shared ({ caller }) func writeRoleThenLoseReply(input : IdentityRole.RoleAssignmentInput) : async () {
    onlyOperator(caller);
    let ?prepared = RoleIntent.prepare(input) else throw Error.reject("invalid synthetic role");
    roleIntent := ?RoleIntent.startRemoteWrite(prepared);
    await checkpointRoleJournal(input.logicalId);
    requireCycleReserve();
    let result = await authority.writeCoreRoleAssignment(input);
    switch (result) { case (#acknowledged) {}; case (_) { throw Error.reject("synthetic role write failed") } };
    roleIntent := ?RoleIntent.lostReply(RoleIntent.startRemoteWrite(prepared));
    throw Error.reject("deliberately lost synthetic role authority reply");
  };

  public shared ({ caller }) func reconcileLostRoleReply() : async MutationRecovery.RecoveryDecision {
    onlyOperator(caller);
    let ?journal = roleIntent else return #blocked;
    let observation = await authority.lookupCoreRoleAssignment(journal.input.logicalId);
    let remote : MutationRecovery.RemoteObservation = switch (observation) {
      case (#absent) #absent;
      case (#present(value)) #present(value);
      case (_) return #blocked;
    };
    let (updated, decision) = RoleIntent.reconcile(RoleIntent.lostReply(journal), remote);
    roleIntent := ?updated;
    decision;
  };

  /// Models a role-assignment interruption after its immutable intent is
  /// durable but before any authority call. Recovery may retry only this
  /// stored tuple; accepting replacement role input here would bypass the
  /// journal and permit a different logical operation after an upgrade.
  public shared ({ caller }) func journalRoleThenTrapBeforeAwait(input : IdentityRole.RoleAssignmentInput) : async () {
    onlyOperator(caller);
    let ?prepared = RoleIntent.prepare(input) else throw Error.reject("invalid synthetic role");
    roleIntent := ?RoleIntent.startRemoteWrite(prepared);
    throw Error.reject("deliberately interrupted role before synthetic authority call");
  };

  /// Deliberately takes no caller input. It can redeliver only the durable
  /// role intent that a preceding bounded lookup classified as absent.
  public shared ({ caller }) func retryJournaledRoleWriteThenLoseReply() : async () {
    onlyOperator(caller);
    let ?journal = roleIntent else throw Error.reject("missing synthetic role journal");
    if (journal.phase != #remoteWriteStarted) {
      throw Error.reject("synthetic role journal is not eligible for identical retry");
    };
    await checkpointRoleJournal(journal.input.logicalId);
    requireCycleReserve();
    let result = await authority.writeCoreRoleAssignment(journal.input);
    switch (result) { case (#acknowledged) {}; case (_) { throw Error.reject("synthetic role retry failed") } };
    roleIntent := ?RoleIntent.lostReply(journal);
    throw Error.reject("deliberately lost synthetic role authority retry reply");
  };

  // Role activation has the same separate acknowledgement boundary as an
  // identity binding. The archive receives only this immutable tuple, never
  // the role label or principal, and a lost reply cannot activate the role.
  public shared ({ caller }) func archiveRoleThenLoseReply() : async () {
    onlyOperator(caller);
    let ?journal = roleIntent else throw Error.reject("missing synthetic role journal");
    let tuple : Archive.ArchiveTuple = { logicalId = journal.input.logicalId; version = journal.input.desiredVersion; contentHash = journal.input.contentHash };
    roleArchive := ?tuple;
    let receipt = await archive.archive(tuple);
    if (Archive.decide(tuple, ?receipt) != #acknowledge) throw Error.reject("synthetic role archive mismatch");
    throw Error.reject("deliberately lost synthetic role archive reply");
  };

  public shared ({ caller }) func reconcileRoleArchive() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?expected = roleArchive else return #blocked;
    let decision = Archive.decide(expected, await archive.lookup(expected.logicalId));
    if (decision == #acknowledge) roleActive := true;
    decision;
  };

  public shared ({ caller }) func isRoleActive() : async Bool {
    onlyOperator(caller);
    roleActive;
  };
}
