/// Local-only M1 proof that an intent written before an inter-canister await
/// survives a trap after the remote commit and is reconciled without a second
/// write. This actor is never a target application service.
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Journal "../../canisters/shared/DurableMutationJournal";

persistent actor class DurableJournalRecoveryFixture(owner : Principal, remoteId : Principal) = this {
  type Remote = actor {
    write : (Text, Blob) -> async Result.Result<(), Text>;
    lookup : (Text) -> async Result.Result<?Blob, Text>;
  };
  let remote : Remote = actor (Principal.toText(remoteId));
  var journal : Journal.State = Journal.empty;

  func authorized(caller : Principal) : Bool {
    not Principal.isAnonymous(caller) and Principal.equal(caller, owner);
  };

  /// Intentionally traps after the remote has acknowledged. The intent was
  /// assigned before the await, so it is the durable recovery checkpoint.
  public shared ({ caller }) func commitThenCrash(operationId : Text, logicalId : Text, desiredHash : Blob) : async Result.Result<(), Text> {
    if (not authorized(caller)) return #err("unauthorized");
    switch (Journal.prepare(journal, operationId, logicalId, desiredHash)) {
      case (#err(error)) return #err(debug_show (error));
      case (#ok((next, #acknowledged))) return #ok(());
      case (#ok((next, #prepared))) { journal := next };
      case (#ok((next, #duplicate))) { journal := next };
    };
    switch (await remote.write(operationId, desiredHash)) {
      case (#err(error)) return #err(error);
      case (#ok(())) Debug.trap("intentional M1 crash after remote acknowledgement");
    };
  };

  /// Reconciliation queries the authoritative remote record by the same
  /// operation ID. It never constructs new transaction material or writes the
  /// remote actor again.
  public shared ({ caller }) func reconcile(operationId : Text) : async Result.Result<Journal.ReconcileResult, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    switch (await remote.lookup(operationId)) {
      case (#err(error)) #err(error);
      case (#ok(remoteHash)) {
        switch (Journal.reconcile(journal, operationId, remoteHash)) {
          case (#err(error)) #err(debug_show (error));
          case (#ok((next, result))) {
            journal := next;
            #ok(result);
          };
        };
      };
    };
  };

  public shared query ({ caller }) func isAcknowledged(operationId : Text) : async Result.Result<Bool, Text> {
    if (not authorized(caller)) return #err("unauthorized");
    #ok(Journal.isAcknowledged(journal, operationId));
  };
};
