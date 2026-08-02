// Synthetic persistent owner for the M1 archive-failure proof. It is kept in
// its own module because the pinned Motoko compiler permits one actor class per
// module. The runner copies it only into an ephemeral ZenDB checkout.

import CanisterDB "../../src/RemoteInstance/CanisterDB";
import ArchiveSink "./M1ArchiveSink";
import Principal "mo:core@2.4/Principal";
import Runtime "mo:core@2.4/Runtime";

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

  // The phase is journaled before the archive await. A rejected reply keeps
  // the remote record pending and cannot publish it as authoritative.
  public func archiveAndActivate() : async () {
    if (phase == "staged") {
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
