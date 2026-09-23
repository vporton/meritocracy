import Blob "mo:base/Blob";
import ZenDB "mo:zendb";
import Saga "../application/TreasuryOperationSaga";
import StorageCatalog "../shared/StorageCatalog";

/// Treasury-private inbox for the one application-to-treasury route.  This
/// collection deliberately holds only the immutable recovery tuple; payment
/// operation, destination, amount, caller, and chain material never cross
/// this boundary through the inbox.
module {
  public type WriteResult = { #acknowledged; #blocked; #conflict; #storageError };
  public type Observation = {
    #absent;
    #present : { version : Nat64; contentHash : Blob };
    #conflict;
    #storageError;
  };

  type Record = { logicalId : Text; version : Nat64; contentHash : Blob };
  public type Store = ZenDB.Collection<Record>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text), ("version", #Nat64), ("contentHash", #Blob),
  ]);
  let candify : ZenDB.Types.Candify<Record> = {
    from_blob = func(blob : Blob) : ?Record { from_candid (blob) };
    to_blob = func(record : Record) : Blob { to_candid (record) };
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<Record>(
      "treasury_application_inbox_v1", schema, candify,
      ?{ schema_constraints = [#Unique(["logicalId"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<Record>("treasury_application_inbox_v1", candify) else return null;
    ?collection;
  };

  public func validEncoding(input : Saga.Input) : Bool {
    Saga.prepare(input) != null and 4_096 <= StorageCatalog.limits.maxDocumentBytes;
  };

  public func decideIdempotentWrite(
    input : Saga.Input,
    observed : ?{ version : Nat64; contentHash : Blob },
  ) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (observed) {
      case null #conflict;
      case (?existing) {
        if (existing.version == input.version and existing.contentHash == input.contentHash) #acknowledged else #conflict;
      };
    };
  };

  public func write(store : Store, input : Saga.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.insert({ logicalId = input.logicalId; version = input.version; contentHash = input.contentHash })) {
            case (#ok(_)) #acknowledged;
            case (#err(_)) #storageError;
          };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideIdempotentWrite(input, ?{ version = existing.version; contentHash = existing.contentHash });
        } else #conflict;
      };
    };
  };

  /// The sole recovery read is bounded and returns no payment data.
  public func lookup(store : Store, logicalId : Text) : Observation {
    if (logicalId.size() == 0 or logicalId.size() > 512) return #conflict;
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return #conflict;
    };
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) #absent else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          #present({ version = existing.version; contentHash = existing.contentHash });
        } else #conflict;
      };
    };
  };
};
