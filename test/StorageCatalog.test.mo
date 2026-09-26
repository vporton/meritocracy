import Array "mo:base/Array";
import StorageCatalog "../canisters/shared/StorageCatalog";

let catalog = StorageCatalog.collections();

func hasIndex(collection : StorageCatalog.Collection, name : Text) : Bool {
  for (index in collection.indexes.vals()) {
    if (index.name == name) {
      return true;
    };
  };
  false;
};

func hasGrant(
  collection : StorageCatalog.Collection,
  subject : StorageCatalog.Subject,
  access : StorageCatalog.Access,
) : Bool {
  for (grant in collection.grants.vals()) {
    if (grant.0 == subject and grant.1 == access) {
      return true;
    };
  };
  false;
};

func hasCollectionIndex(collectionName : Text, indexName : Text) : Bool {
  for (collection in catalog.vals()) {
    if (collection.name == collectionName) {
      return hasIndex(collection, indexName);
    };
  };
  false;
};

// The private application-to-treasury outbox and treasury inbox are durable
// saga collections, separate from imported legacy rows and payment operations.
assert (Array.size(catalog) == 22);
assert (StorageCatalog.limits.maxDocumentBytes == 262_144);
assert (StorageCatalog.limits.maxBatchBytes == 1_048_576);
assert (StorageCatalog.limits.maxPageSize == 500);
// Catalogue-only evidence collections must retain only their approved lookup
// shape: no provider-session or raw-payload identity is an index key.
assert (hasCollectionIndex("migration_evidence_v1", "migration_source_row_unique"));
assert (hasCollectionIndex("migration_evidence_v1", "migration_observed"));
assert (hasCollectionIndex("ai_artifact_v1", "redacted_result_hash_unique"));
assert (hasCollectionIndex("ai_artifact_v1", "retention_due"));
assert (hasCollectionIndex("evidence_kyc_v1", "audit_event_unique"));
assert (hasCollectionIndex("evidence_kyc_v1", "principal_expiry"));

for (collection in catalog.vals()) {
  // A newly named collection cannot accidentally lose the logical-ID recovery
  // index or replace the owner/governance split with an application admin role.
  assert (hasIndex(collection, "logical_id_unique"));
  assert (hasIndex(collection, "state_updated"));
  assert (hasGrant(collection, #ownerCanister, #read));
  assert (hasGrant(collection, #ownerCanister, #write));
  assert (hasGrant(collection, #governance, #admin));
  assert (not hasGrant(collection, #ownerCanister, #admin));
};
