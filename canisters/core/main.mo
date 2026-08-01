import StorageCatalog "../shared/StorageCatalog";
import StorageTypes "../shared/StorageTypes";

// M1 interface scaffold only. Importing the storage contract makes its Motoko
// syntax part of the build without creating state, methods, or ZenDB access.
persistent actor {
  // These private aliases are compile-time contract checks, not canister state.
  type _MutationIntentContract = StorageTypes.MutationIntentV1;
  let _storageLimits = StorageCatalog.limits;
};
