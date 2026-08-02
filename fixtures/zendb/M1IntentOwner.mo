// Synthetic persistent owning application for the M1 local ZenDB proof. The
// runner copies this actor class into an ephemeral pinned ZenDB checkout; it
// is never deployed with Meritocracy canisters or given a production grant.

import ZenDB "../../src";
import CanisterDB "../../src/RemoteInstance/CanisterDB";
import ArchiveSink "./M1ArchiveSink";
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

// A separate synthetic owner for staged archive data. It proves the archive
// boundary is not merely an advisory outbox: the ZenDB record remains pending
// until the archive receiver has acknowledged the same logical-ID/hash pair.
persistent actor class ArchiveIntentOwner(
  dbPrincipal : Principal,
  archivePrincipal : Principal,
  database : Text,
  collection : Text,
) = this {
  type Intent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
  };

  transient let db : CanisterDB.CanisterDB = actor (Principal.toText(dbPrincipal));
  transient let archive : ArchiveSink.ArchiveSink = actor (Principal.toText(archivePrincipal));
  let logicalId = "intent:archive-failure";
  let desiredHash : Blob = "archive-content-hash";
  var phase = "prepared";
  var documentId : ?Blob = null;

  func encode(intent : Intent) : Blob { to_candid (intent) };

  func load() : async Intent {
    let ?id = documentId else Runtime.trap("archive fixture has no staged document ID");
    let #ok(blob) = await db.zendb_v1_collection_get_document(database, collection, id) else Runtime.trap("archive fixture could not load staged data");
    let ?intent : ?Intent = from_candid (blob) else Runtime.trap("archive fixture decoded malformed data");
    intent;
  };

  public func whoami() : async Principal { Principal.fromActor(this) };

  public query func currentPhase() : async Text { phase };

  public func currentStoredState() : async Text {
    (await load()).state;
  };

  public func stage() : async () {
    assert (phase == "prepared");
    // The ordinary staged-write protocol is independently covered by the
    // lost-reply fixture above. This archive fixture starts from the durable,
    // acknowledged pending record it requires.
    let pending : Intent = {
      logicalId;
      contentHash = desiredHash;
      state = "pendingArchive";
      updatedAtNs = 20;
    };
    let #ok(id) = await db.zendb_v1_collection_insert_document(database, collection, encode(pending)) else Runtime.trap("archive fixture could not stage data");
    documentId := ?id;
    phase := "staged";
  };

  // The owner journals this phase before its archive await. A rejected
  // archive reply therefore leaves the record pending and cannot publish it
  // as authoritative.
  public func archiveAndActivate() : async () {
    if (phase == "staged") {
      // This durable mutation is committed at the following await boundary.
      // A rejected archive reply therefore cannot roll it back and disguise
      // an ambiguous handoff as a record that was never attempted.
      phase := "archiveStarted";
    } else {
      assert (phase == "archiveStarted");
    };
    await archive.archive(logicalId, desiredHash);
    let ?id = documentId else Runtime.trap("archive fixture lost its staged document ID");
    let active : Intent = {
      logicalId;
      contentHash = desiredHash;
      state = "active";
      updatedAtNs = 21;
    };
    let #ok(_) = await db.zendb_v1_collection_replace_document(database, collection, id, encode(active)) else Runtime.trap("archive acknowledgement could not activate staged data");
    phase := "active";
  };
};
