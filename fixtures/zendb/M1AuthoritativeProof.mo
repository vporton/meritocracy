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
import Principal "mo:core@2.4/Principal";
import Runtime "mo:core@2.4/Runtime";
import { test } "mo:test/async";
import IntentOwner "./M1IntentOwner";

persistent actor this_test {
  transient let TRILLION = 1_000_000_000_000;
  transient let database = "m1";
  transient let collection = "intents";

  // The first database principal is exposed only to the local runner so it
  // can install the exact same actor class in upgrade mode.  It is never a
  // production identifier or a persisted application grant.
  var upgradeTarget : ?Principal = null;

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
        upgradeTarget := ?Principal.fromActor(db);
        // Remote CanisterDB keeps database creation separate from collection
        // creation. The test owns this synthetic database through the actor
        // class's caller binding before it exercises any collection invariant.
        let #ok(_) = await db.zendb_v1_create_database(database) else return assert false;
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
        // The remote cursor is opaque: it advances in ZenDB document-ID order,
        // not application logical-ID order. The owning canister therefore keeps
        // its own logical-ID/hash reconciliation and uses this only as a bounded
        // repair traversal cursor.
        let firstPageQuery = ZenDB.QueryBuilder().Limit(1).build();
        let #ok(firstPage) = await db.zendb_v1_collection_search(database, collection, firstPageQuery) else return assert false;
        assert (firstPage.documents.size() == 1);
        assert (firstPage.has_more);
        assert (firstPage.instructions > 0);

        let secondPageQuery = ZenDB.QueryBuilder().PaginationToken(firstPage.pagination_token).Limit(1).build();
        let #ok(secondPage) = await db.zendb_v1_collection_search(database, collection, secondPageQuery) else return assert false;
        assert (secondPage.documents.size() == 1);
        assert (secondPage.pagination_token != firstPage.pagination_token);
        assert (secondPage.instructions > 0);

        // The generated ZenDB document ID remains non-authoritative metadata.
        let #ok(firstBlob) = await db.zendb_v1_collection_get_document(database, collection, firstDocumentId) else return assert false;
        assert (decode(firstBlob).logicalId == first.logicalId);

        // The constructor creates exactly two global admins: the provisional
        // owner and ZenDB's internal self-grant.  Audit that matrix before
        // revocation; no browser/user/importer grant is accepted.
        let owner = Principal.fromActor(this_test);
        let dbPrincipal = Principal.fromActor(db);
        let #ok(allGrants) = await db.get_all_users_access_details() else return assert false;
        assert (allGrants.size() == 2);
        var ownerAdmin = false;
        var selfAdmin = false;
        for ((principal, grants) in allGrants.vals()) {
          assert (principal == owner or principal == dbPrincipal);
          for ((scope, role, _) in grants.vals()) {
            assert (scope.size() == 0);
            assert (role == "admin");
            if (principal == owner) ownerAdmin := true;
            if (principal == dbPrincipal) selfAdmin := true;
          };
        };
        assert (ownerAdmin and selfAdmin);

        // The test actor is the provisional bootstrap owner.  It is removed
        // before any upgrade so an upgrade cannot accidentally restore a
        // deployer/admin path.
        let #ok(_) = await db.revoke_global_access(owner, "admin") else return assert false;
        let #ok(grants) = await db.get_my_access_details() else return assert false;
        assert (grants.size() == 0);
        let #err(_) = await db.zendb_v1_collection_insert_document(database, collection, encode(second)) else return assert false;
        let #err(_) = await db.grant_global_access(owner, "admin") else return assert false;
      },
    );

    await test(
      "a persistent owner reconciles a real lost reply and duplicate delivery",
      func() : async () {
        let db = await (with cycles = 5 * TRILLION) CanisterDB.CanisterDB();
        let #ok(_) = await db.zendb_v1_create_database("m1_lost_reply") else return assert false;
        let #ok(_) = await db.zendb_v1_create_collection("m1_lost_reply", collection, intentSchema, null) else return assert false;
        let #ok(_) = await db.zendb_v1_collection_create_index(
          "m1_lost_reply",
          collection,
          "logical_id_unique",
          [("logicalId", #Ascending)],
          ?{ is_unique = true },
        ) else return assert false;

        // The synthetic owner is a distinct canister principal, so this is the
        // same collection-scoped writer boundary intended for an owning target
        // application canister. It receives no administration grant.
        let owner = await (with cycles = TRILLION) IntentOwner.IntentOwner(Principal.fromActor(db), "m1_lost_reply", collection);
        let ownerPrincipal = await owner.whoami();
        let #ok(_) = await db.grant_collection_access(ownerPrincipal, "writer", "m1_lost_reply", collection) else return assert false;

        var rejected = false;
        try {
          await owner.submitAndLoseReply();
        } catch (_) {
          rejected := true;
        };
        assert (rejected);
        // The only durable local state after a post-await rejection is the
        // pre-await journal transition, while ZenDB has the one remote write.
        assert ((await owner.currentPhase()) == "remoteWriteStarted");

        await owner.redeliverAndReconcile();
        assert ((await owner.currentPhase()) == "acknowledged");
      },
    );
  };

  // Called after the runner upgrades the remote database canister.  The
  // method re-derives the actor reference from a stable principal and checks
  // both the revoked grant and the fail-closed write/escalation boundary.
  public func verifyPostUpgradeRevocation() : async Bool {
    let ?target = upgradeTarget else return false;
    let db : CanisterDB.CanisterDB = actor (Principal.toText(target));
    let #ok(grants) = await db.get_my_access_details() else return false;
    if (grants.size() != 0) return false;
    let probe : Intent = {
      logicalId = "intent:post-upgrade-probe";
      contentHash = "post-upgrade-probe";
      state = "pending";
      updatedAtNs = 99;
    };
    switch (await db.zendb_v1_collection_insert_document(database, collection, encode(probe))) {
      case (#ok(_)) return false;
      case (#err(_)) {};
    };
    switch (await db.grant_global_access(Principal.fromActor(this_test), "admin")) {
      case (#ok(_)) false;
      case (#err(_)) true;
    };
  };
};
