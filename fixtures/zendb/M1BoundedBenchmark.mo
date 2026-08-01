// Synthetic-only M1 benchmark for the exact pinned ZenDB candidate. The
// runner copies this actor into an ephemeral ZenDB checkout and deploys it to
// a fresh local DFX replica; it is not part of any Meritocracy canister.
//
// This deliberately reports only measurements exposed by ZenDB v2.0.1. In
// particular, create-index/reindex and insert do not return instruction
// counters, so this harness records their data sizes and explicitly does not
// manufacture instruction figures for them.

import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import ZenDB "../../src";
import CanisterDB "../../src/RemoteInstance/CanisterDB";
import Runtime "mo:core@2.4/Runtime";

persistent actor {
  transient let TRILLION = 1_000_000_000_000;
  transient let database = "m1_bounded_benchmark";
  transient let expectedDocuments = 16;
  transient let twiceExpectedDocuments = 32;
  transient let maxDocumentBytes = 262_144;
  transient let maxBatchBytes = 1_048_576;

  type SyntheticIntent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
    payload : Text;
  };

  // These are candidate-exposed figures, rather than wall-clock timings.
  // Callers must still establish an instruction budget for the owning actor
  // before G2; a local replica cannot establish a production cycle budget.
  public type Metrics = {
    scenario : Text;
    documents : Nat;
    averageDocumentBytes : Nat;
    totalDocumentBytes : Nat;
    indexEntries : Nat;
    indexBytes : Nat;
    remoteWriteBytes : Nat;
    remoteReadBytes : Nat;
    queryInstructions : Nat;
    replaceInstructions : Nat;
    deleteInstructions : Nat;
    reindexEntries : Nat;
  };

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("contentHash", #Blob),
    ("state", #Text),
    ("updatedAtNs", #Int),
    ("payload", #Text),
  ]);

  func encode(intent : SyntheticIntent) : Blob { to_candid (intent) };

  func decode(blob : Blob) : SyntheticIntent {
    let ?intent : ?SyntheticIntent = from_candid (blob) else Runtime.trap("synthetic benchmark intent did not decode");
    intent;
  };

  func syntheticIntent(scenario : Text, ordinal : Nat, state : Text) : SyntheticIntent {
    {
      logicalId = "intent:" # scenario # ":" # Nat.toText(ordinal);
      contentHash = Blob.fromArray(Array.tabulate<Nat8>(32, func(i) = Nat8.fromNat((ordinal + i) % 256)));
      state;
      updatedAtNs = ordinal;
      // Fixed synthetic content makes bytes/document comparable between the
      // expected and 2x distributions and contains no user or production data.
      payload = "m1-synthetic-payload-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    };
  };

  func withinEnvelope(documentBytes : Nat, batchBytes : Nat) : Bool {
    documentBytes <= maxDocumentBytes and batchBytes <= maxBatchBytes;
  };

  func assertBoundedDocument(blob : Blob) {
    assert (withinEnvelope(blob.size(), 0));
  };

  func assertBoundedBatch(bytes : Nat) {
    assert (withinEnvelope(0, bytes));
  };

  func createCollection(db : CanisterDB.CanisterDB, collection : Text) : async () {
    let #ok(_) = await db.zendb_v1_create_collection(database, collection, schema, null) else Runtime.trap("could not create synthetic benchmark collection");
    let #ok(_) = await db.zendb_v1_collection_create_index(
      database,
      collection,
      "logical_id_unique",
      [("logicalId", #Ascending)],
      ?{ is_unique = true },
    ) else Runtime.trap("could not create synthetic logical-ID index");
    let #ok(_) = await db.zendb_v1_collection_create_index(
      database,
      collection,
      "state_updated",
      [("state", #Ascending), ("updatedAtNs", #Ascending), ("logicalId", #Ascending)],
      null,
    ) else Runtime.trap("could not create synthetic repair index");
  };

  func runScenario(db : CanisterDB.CanisterDB, scenario : Text, documents : Nat) : async Metrics {
    let collection = "intents_" # scenario;
    await createCollection(db, collection);

    var remoteWriteBytes = 0;
    var ordinal = 0;
    var firstId : ?Blob = null;
    while (ordinal < documents) {
      let encoded = encode(syntheticIntent(scenario, ordinal, "pending"));
      assertBoundedDocument(encoded);
      assertBoundedBatch(remoteWriteBytes + encoded.size());
      let #ok(documentId) = await db.zendb_v1_collection_insert_document(database, collection, encoded) else Runtime.trap("could not insert bounded synthetic benchmark document");
      if (ordinal == 0) firstId := ?documentId;
      remoteWriteBytes += encoded.size();
      ordinal += 1;
    };

    let lookupQuery = ZenDB.QueryBuilder().Where("logicalId", #eq(#Text("intent:" # scenario # ":0"))).Limit(1).build();
    let #ok(found) = await db.zendb_v1_collection_search(database, collection, lookupQuery) else Runtime.trap("could not read synthetic benchmark document");
    assert (found.documents.size() == 1);
    let (_, recovered, _) = found.documents[0];
    assert (decode(recovered).logicalId == "intent:" # scenario # ":0");

    let ?firstDocumentId = firstId else Runtime.trap("benchmark has no first document");
    let replacement = encode(syntheticIntent(scenario, 0, "reconciled"));
    assertBoundedDocument(replacement);
    let #ok(replaced) = await db.zendb_v1_collection_replace_document(database, collection, firstDocumentId, replacement) else Runtime.trap("could not replace synthetic benchmark document");

    // Rebuilding the explicit index is an operationally distinct action. The
    // pinned API returns no instruction count for it, so record only the
    // resulting index entries and leave budget approval blocked on that gap.
    let #ok(_) = await db.zendb_v1_collection_delete_index(database, collection, "state_updated") else Runtime.trap("could not delete synthetic repair index");
    let #ok(_) = await db.zendb_v1_collection_create_index(
      database,
      collection,
      "state_updated_rebuilt",
      [("state", #Ascending), ("updatedAtNs", #Ascending), ("logicalId", #Ascending)],
      null,
    ) else Runtime.trap("could not rebuild synthetic repair index");
    let #ok(?rebuiltIndex) = await db.zendb_v1_collection_get_index(database, collection, "state_updated_rebuilt") else Runtime.trap("could not inspect rebuilt synthetic repair index");

    let #ok(deleted) = await db.zendb_v1_collection_delete_document_by_id(database, collection, firstDocumentId) else Runtime.trap("could not delete synthetic benchmark document");
    assert (decode(deleted.deleted_document).logicalId == "intent:" # scenario # ":0");

    let stats = await db.zendb_v1_collection_stats(database, collection);
    assert (stats.entries == documents - 1);
    let #ok(?logicalIdIndex) = await db.zendb_v1_collection_get_index(database, collection, "logical_id_unique") else Runtime.trap("could not inspect synthetic logical-ID index");
    assert (logicalIdIndex.entries == documents - 1);

    {
      scenario;
      documents;
      averageDocumentBytes = stats.avg_document_size;
      totalDocumentBytes = stats.total_document_size;
      indexEntries = logicalIdIndex.entries;
      indexBytes = logicalIdIndex.total_index_data_bytes;
      remoteWriteBytes;
      remoteReadBytes = recovered.size();
      queryInstructions = found.instructions;
      replaceInstructions = replaced.instructions;
      deleteInstructions = deleted.instructions;
      reindexEntries = rebuiltIndex.entries;
    };
  };

  /// Runs expected and 2x synthetic distributions. This method is deliberately
  /// callable only in the ephemeral proof actor, and never enables a target
  /// application collection or a production-sized benchmark.
  public func runTests() : async [Metrics] {
    // These rejection-limit cases execute before a remote call. They prove the
    // synthetic owning-side envelope cannot accidentally forward a single
    // over-limit document or accumulated batch to the candidate.
    assert (not withinEnvelope(maxDocumentBytes + 1, 0));
    assert (not withinEnvelope(0, maxBatchBytes + 1));
    let db = await (with cycles = 5 * TRILLION) CanisterDB.CanisterDB();
    let #ok(_) = await db.zendb_v1_create_database(database) else Runtime.trap("could not create synthetic benchmark database");
    [
      await runScenario(db, "expected", expectedDocuments),
      await runScenario(db, "two_x", twiceExpectedDocuments),
    ];
  };
};
