// Disposable M1 proof fixture for a canonical treasury-journal archive export.
// Its journal set is fixed at installation. Public proof methods accept no
// posting, tuple, byte, hash, or repair replacement input.
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Archive "../../canisters/treasury/TreasuryJournalArchiveRecovery";
import Binding "../../canisters/treasury/TreasuryJournalArchiveExportBinding";
import Saga "../../canisters/treasury/TreasuryJournalArchiveExportSaga";
import BalancedSet "../../canisters/treasury/TreasuryJournalBalancedSet";

shared ({ caller = installer }) persistent actor class (
  operator : Principal,
  archiveId : Principal,
  fixedSet : BalancedSet.Input,
) = this {
  assert not Principal.isAnonymous(operator);
  assert installer != operator;
  assert BalancedSet.valid(fixedSet);

  let archive : actor {
    archive : shared Binding.Binding -> async Archive.ArchiveTuple;
    lookup : shared Text -> async ?Archive.ArchiveTuple;
    retainsExact : shared Binding.Binding -> async Bool;
  } = actor (Principal.toText(archiveId));

  // The complete canonical binding (tuple plus bytes) is durable before the
  // first archive await. It is never reconstructed from caller input.
  var exportState : ?Saga.State = null;

  func onlyOperator(caller : Principal) { assert caller == operator };

  public shared ({ caller }) func prepareArchiveExport() : async () {
    onlyOperator(caller);
    switch (exportState) {
      case (?_) throw Error.reject("synthetic canonical archive export already retained");
      case null {
        let ?prepared = Saga.prepare(fixedSet, 1) else {
          throw Error.reject("invalid synthetic canonical archive export");
        };
        exportState := ?prepared;
      };
    };
  };

  // Models interruption after durable binding retention and before any sink
  // call. Recovery below has no bytes, tuple, or posting parameter.
  public shared ({ caller }) func archiveThenTrapBeforeAwait() : async () {
    onlyOperator(caller);
    let ?saved = exportState else throw Error.reject("missing synthetic canonical archive export");
    let started = Saga.startArchive(fixedSet, saved);
    if (started == saved) throw Error.reject("canonical archive export is not dispatchable");
    exportState := ?started;
    throw Error.reject("deliberately interrupted before canonical archive await");
  };

  // A successful sink response is deliberately discarded. The pre-await
  // state is already durable, so reconciliation can only inspect the exact
  // retained logical-ID/version/hash receipt.
  public shared ({ caller }) func archiveThenLoseReply() : async () {
    onlyOperator(caller);
    let ?saved = exportState else throw Error.reject("missing synthetic canonical archive export");
    let started = Saga.startArchive(fixedSet, saved);
    if (started == saved) throw Error.reject("canonical archive export is not dispatchable");
    exportState := ?started;
    let receipt = await archive.archive(started.binding);
    if (Archive.decide(started.binding.tuple, ?receipt) != #acknowledge) {
      throw Error.reject("synthetic canonical archive receipt mismatch");
    };
    throw Error.reject("deliberately lost synthetic canonical archive reply");
  };

  public shared ({ caller }) func reconcileArchiveExport() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?saved = exportState else return #blocked;
    let updated = Saga.reconcile(fixedSet, saved, await archive.lookup(saved.binding.tuple.logicalId));
    exportState := ?updated;
    switch (updated.phase) {
      case (#acknowledged) #acknowledge;
      case (#blocked) #blocked;
      case (_) #remainPending;
    };
  };

  // Operator repair is tuple/bytes-free. It first reconciles the retained
  // binding; if receipt is absent it can send only that same binding again.
  public shared ({ caller }) func repairArchiveExport() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?saved = exportState else return #blocked;
    let reconciled = Saga.reconcile(fixedSet, saved, await archive.lookup(saved.binding.tuple.logicalId));
    exportState := ?reconciled;
    switch (reconciled.phase) {
      case (#acknowledged) #acknowledge;
      case (#blocked) #blocked;
      case (#prepared or #archiveStarted or #pending) {
        let started = Saga.startArchive(fixedSet, reconciled);
        exportState := ?started;
        let receipt = await archive.archive(started.binding);
        if (Archive.decide(started.binding.tuple, ?receipt) != #acknowledge) {
          throw Error.reject("synthetic canonical archive repair receipt mismatch");
        };
        #remainPending;
      };
    };
  };

  // Proves the sink retained the byte-identical derived binding, not merely a
  // matching receipt tuple. The result carries no archive bytes back to the
  // caller and is useful only after exact acknowledgement.
  public shared ({ caller }) func archiveRetainsExactExport() : async Bool {
    onlyOperator(caller);
    let ?saved = exportState else return false;
    if (saved.phase != #acknowledged) return false;
    await archive.retainsExact(saved.binding);
  };

  public shared ({ caller }) func archivePhase() : async Saga.Phase {
    onlyOperator(caller);
    switch (exportState) { case (?saved) saved.phase; case null #blocked };
  };
};
