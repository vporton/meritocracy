// Synthetic persistent owner for the M1 local ZenDB low-cycle proof. It
// retains one fixed logical-ID/hash tuple before evaluating its local reserve,
// and has no caller-provided write input on retry.

import Cycles "mo:base/ExperimentalCycles";
import ZenDB "../../src";
import CanisterDB "../../src/RemoteInstance/CanisterDB";
import Principal "mo:core@2.4/Principal";
import Runtime "mo:core@2.4/Runtime";

persistent actor class LowCycleIntentOwner(
  dbPrincipal : Principal,
  database : Text,
  collection : Text,
) = this {
  // This proof-only threshold intentionally exceeds the fixture's two
  // trillion-cycle installation allocation. It is not a production budget.
  transient let minimumReserve = 3_000_000_000_000;
  transient let db : CanisterDB.CanisterDB = actor (Principal.toText(dbPrincipal));
  let logicalId = "intent:low-cycle-retained";
  let desiredHash : Blob = "low-cycle-content-hash";
  var phase = "prepared";

  type Intent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
  };

  func encode(intent : Intent) : Blob { to_candid (intent) };

  func retainedIntent() : Intent {
    {
      logicalId;
      contentHash = desiredHash;
      state = "pending";
      updatedAtNs = 30;
    };
  };

  public func whoami() : async Principal { Principal.fromActor(this) };

  public query func currentPhase() : async Text { phase };

  // The durable phase is committed before the reserve decision. A low-cycle
  // path returns normally, so it cannot roll back that retained intent.
  public func retainThenTry() : async Text {
    if (phase == "prepared") phase := "retained";
    if (phase != "retained") return "blocked";
    if (Cycles.balance() < minimumReserve) return "blocked";
    let #ok(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(retainedIntent())) else Runtime.trap("replenished low-cycle fixture could not write retained intent");
    phase := "acknowledged";
    "acknowledged";
  };

  // This endpoint accepts only attached local-replica cycles. It has no
  // external balance source, wallet, or authority and exists solely so the
  // parent synthetic actor can replenish the disposable fixture.
  public func acceptSyntheticTopUp() : async Nat {
    Cycles.accept<system>(Cycles.available());
  };
};
