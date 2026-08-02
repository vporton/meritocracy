// Synthetic persistent owning application for the M1 local ZenDB proof. The
// runner copies this actor class into an ephemeral pinned ZenDB checkout; it
// is never deployed with Meritocracy canisters or given a production grant.

import ZenDB "../../src";
import CanisterDB "../../src/RemoteInstance/CanisterDB";
import Principal "mo:core@2.4/Principal";
import Runtime "mo:core@2.4/Runtime";

persistent actor class IntentOwner(
  dbPrincipal : Principal,
  database : Text,
  collection : Text,
) = this {
  type Intent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
  };

  // Re-derive this transient actor reference after an upgrade from the
  // persistent principal rather than persisting an actor reference.
  transient let db : CanisterDB.CanisterDB = actor (Principal.toText(dbPrincipal));
  let logicalId = "intent:lost-reply";
  let desiredHash : Blob = "lost-reply-content-hash";
  var phase = "prepared";

  func encode(intent : Intent) : Blob { to_candid (intent) };

  func lookup() : async Intent {
    let #ok(result) = await db.zendb_v1_collection_search(
      database,
      collection,
      ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(1).build(),
    ) else Runtime.trap("synthetic owner could not reconcile the lost reply");
    assert (result.documents.size() == 1);
    let (_, blob, _) = result.documents[0];
    let ?intent : ?Intent = from_candid (blob) else Runtime.trap("synthetic owner recovered malformed intent");
    intent;
  };

  public func whoami() : async Principal { Principal.fromActor(this) };

  public query func currentPhase() : async Text { phase };

  // `phase` is committed before the remote call. Once ZenDB has accepted the
  // insert, this method deliberately rejects its caller instead of returning
  // the acknowledgement. The rejected reply is therefore a real
  // inter-canister failure boundary, not a mocked result branch.
  public func submitAndLoseReply() : async () {
    assert (phase == "prepared");
    phase := "remoteWriteStarted";
    let intent : Intent = {
      logicalId;
      contentHash = desiredHash;
      state = "pending";
      updatedAtNs = 10;
    };
    let #ok(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(intent)) else Runtime.trap("synthetic owner could not write its prepared intent");
    Runtime.trap("deliberately discard the acknowledged remote reply");
  };

  // This is the duplicate ingress delivery of the same operation and bytes.
  // The pinned remote API rejects the duplicate; the owner then uses its
  // bounded logical-ID/hash lookup to acknowledge the original result rather
  // than allocating a second key or overwriting the first record.
  public func redeliverAndReconcile() : async () {
    assert (phase == "remoteWriteStarted");
    let intent : Intent = {
      logicalId;
      contentHash = desiredHash;
      state = "pending";
      updatedAtNs = 10;
    };
    let #err(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(intent)) else Runtime.trap("synthetic duplicate delivery unexpectedly inserted a second intent");
    let recovered = await lookup();
    assert (recovered.logicalId == logicalId);
    assert (recovered.contentHash == desiredHash);
    phase := "acknowledged";
  };
};
