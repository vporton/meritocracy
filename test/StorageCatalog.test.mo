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

assert (Array.size(catalog) == 20);
assert (StorageCatalog.limits.maxDocumentBytes == 262_144);
assert (StorageCatalog.limits.maxBatchBytes == 1_048_576);
assert (StorageCatalog.limits.maxPageSize == 500);

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
