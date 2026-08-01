// M1 target-data proof for the exact pinned ZenDB remote canister. This file is
// copied into an ephemeral pinned-source checkout by
// scripts/icp/test-zendb-authoritative.sh; it is never deployed with this
// repository's application canisters.
//
// It deliberately uses only synthetic records. It establishes the parts of the
// application-level logical-ID protocol that the remote API can support:
// a unique logical-ID index rejects a second insert, and a query by logical ID
// finds the durable first value after an ambiguous reply. It does not claim that
// ZenDB itself implements an idempotent insert or CAS.

import ZenDB "../../src";
import CanisterDB "../../src/RemoteInstance/CanisterDB";
import Runtime "mo:core@2.4/Runtime";
import { test } "mo:test/async";

persistent actor {
  transient let TRILLION = 1_000_000_000_000;
  transient let database = "m1";
  transient let collection = "intents";

  type Intent = {
    logicalId : Text;
    contentHash : Blob;
    state : Text;
    updatedAtNs : Int;
  };

  let intentSchema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("contentHash", #Blob),
    ("state", #Text),
    ("updatedAtNs", #Int),
  ]);

  func encode(intent : Intent) : Blob { to_candid (intent) };

  func decode(blob : Blob) : Intent {
    let ?intent : ?Intent = from_candid (blob) else Runtime.trap("synthetic ZenDB intent did not decode");
    intent;
  };

  func assertOneLogicalId(
    db : CanisterDB.CanisterDB,
    logicalId : Text,
    expectedHash : Blob,
  ) : async () {
    let #ok(result) = await db.zendb_v1_collection_search(
      database,
      collection,
      ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(1).build(),
    ) else return assert false;

    // The recovery lookup is bounded by a one-document page and must return
    // exactly the existing logical ID, never an arbitrary generated ID.
    assert (result.documents.size() == 1);
    assert (result.instructions > 0);
    let (_, blob, _) = result.documents[0];
    let intent = decode(blob);
    assert (intent.logicalId == logicalId);
    assert (intent.contentHash == expectedHash);
  };

  public func runTests() : async () {
    await test(
      "unique logical IDs recover the first acknowledged content",
      func() : async () {
        let db = await (with cycles = 5 * TRILLION) CanisterDB.CanisterDB();
        let #ok(_) = await db.zendb_v1_create_collection(database, collection, intentSchema, null) else return assert false;

        // The application logical ID is distinct from ZenDB's generated document
        // ID. Its unique index must be created before an authoritative write.
        let #ok(_) = await db.zendb_v1_collection_create_index(
          database,
          collection,
          "logical_id_unique",
          [("logicalId", #Ascending)],
          ?{ is_unique = true },
        ) else return assert false;
        let #ok(_) = await db.zendb_v1_collection_create_index(
          database,
          collection,
          "state_updated",
          [("state", #Ascending), ("updatedAtNs", #Ascending), ("logicalId", #Ascending)],
          null,
        ) else return assert false;

        let first : Intent = {
          logicalId = "intent:0001";
          contentHash = "first-content-hash";
          state = "pending";
          updatedAtNs = 1;
        };
        let #ok(firstDocumentId) = await db.zendb_v1_collection_insert_document(database, collection, encode(first)) else return assert false;

        // A lost reply cannot be retried as a blind second insert. The pinned API
        // rejects even an otherwise identical duplicate, so the caller must use
        // the logical-ID/hash lookup below to confirm success.
        let #err(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(first)) else return assert false;
        await assertOneLogicalId(db, first.logicalId, first.contentHash);

        // A same-logical-ID, different-content retry is also rejected. The first
        // durable value remains authoritative and is available for fail-closed
        // conflict handling by the owning canister.
        let conflicting : Intent = {
          logicalId = first.logicalId;
          contentHash = "conflicting-content-hash";
          state = "active";
          updatedAtNs = 2;
        };
        let #err(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(conflicting)) else return assert false;
        await assertOneLogicalId(db, first.logicalId, first.contentHash);

        let second : Intent = {
          logicalId = "intent:0002";
          contentHash = "second-content-hash";
          state = "pending";
          updatedAtNs = 3;
        };
        let third : Intent = {
          logicalId = "intent:0003";
          contentHash = "third-content-hash";
          state = "pending";
          updatedAtNs = 4;
        };
        let #ok(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(second)) else return assert false;
        let #ok(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(third)) else return assert false;

        // The recovery/repair scan uses opaque remote pagination tokens and a
        // fixed page size; it never uses an offset or returns an unbounded page.
        let firstPageQuery = ZenDB.QueryBuilder().SortBy("logicalId", #Ascending).Limit(1).build();
        let #ok(firstPage) = await db.zendb_v1_collection_search(database, collection, firstPageQuery) else return assert false;
        assert (firstPage.documents.size() == 1);
        assert (firstPage.has_more);
        assert (firstPage.instructions > 0);

        let secondPageQuery = ZenDB.QueryBuilder().SortBy("logicalId", #Ascending).PaginationToken(firstPage.pagination_token).Limit(1).build();
        let #ok(secondPage) = await db.zendb_v1_collection_search(database, collection, secondPageQuery) else return assert false;
        assert (secondPage.documents.size() == 1);
        assert (secondPage.pagination_token != firstPage.pagination_token);
        assert (secondPage.instructions > 0);

        // The generated ZenDB document ID remains non-authoritative metadata.
        let #ok(firstBlob) = await db.zendb_v1_collection_get_document(database, collection, firstDocumentId) else return assert false;
        assert (decode(firstBlob).logicalId == first.logicalId);
      },
    );
  };
};
