import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import ZenDB "mo:zendb";
import Receipt "../archive_router/MigrationReceiptIntent";
import StorageCatalog "../shared/StorageCatalog";

/// Application-private, fixed persistence boundary for canonical-import
/// receipts. This module carries only bounded import metadata and hashes; it
/// cannot decode source rows, receive credentials, or select a collection.
module {
  public type WriteResult = { #acknowledged; #blocked; #conflict; #storageError };
  public type Observation = {
    #absent;
    #present : { version : Nat64; contentHash : Blob };
    #conflict;
    #storageError;
  };

  type Record = {
    logicalId : Text;
    migrationId : Text;
    sourceTable : Text;
    chunk : Nat;
    rowCount : Nat32;
    payloadHash : Blob;
    version : Nat64;
    contentHash : Blob;
  };

  public type Store = ZenDB.Collection<Record>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text), ("migrationId", #Text), ("sourceTable", #Text),
    ("chunk", #Nat), ("rowCount", #Nat32), ("payloadHash", #Blob),
    ("version", #Nat64), ("contentHash", #Blob),
  ]);
  let candify : ZenDB.Types.Candify<Record> = {
    from_blob = func(blob : Blob) : ?Record { from_candid (blob) };
    to_blob = func(record : Record) : Blob { to_candid (record) };
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<Record>(
      "migration_receipt_v1", schema, candify,
      ?{ schema_constraints = [#Unique(["logicalId"]), #Unique(["migrationId", "sourceTable", "chunk"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<Record>("migration_receipt_v1", candify) else return null;
    ?collection;
  };

  func recordFor(input : Receipt.Input) : Record {
    { logicalId = input.logicalId; migrationId = input.migrationId; sourceTable = input.sourceTable;
      chunk = Nat64.toNat(input.chunk); rowCount = input.rowCount; payloadHash = input.payloadHash;
      version = input.desiredVersion; contentHash = input.contentHash };
  };

  public func validEncoding(input : Receipt.Input) : Bool {
    // The receipt contract bounds text to 896 scalar values total. Even at
    // four UTF-8 bytes per scalar, with both 32-byte hashes, Nat64/Nat32
    // values, Candid framing, and field type table, its fixed envelope is
    // below 4 KiB—well below the catalogue's 256 KiB document cap. Avoiding
    // a runtime `to_candid` here also keeps this pure guard executable in the
    // pinned Mops interpreter, whose generic ZenDB decoder is not supported.
    Receipt.valid(input) and 4_096 <= StorageCatalog.limits.maxDocumentBytes;
  };

  public func decideIdempotentWrite(input : Receipt.Input, observed : ?{ version : Nat64; contentHash : Blob }) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (observed) {
      case (?(existing)) {
        if (existing.version == input.desiredVersion and existing.contentHash == input.contentHash) #acknowledged else #conflict;
      };
      case null #conflict;
    };
  };

  /// Insert exactly once. The two-key lookup also fail-closes if a broken
  /// collection were to contain a duplicate logical ID or chunk identity.
  public func write(store : Store, input : Receipt.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.search(ZenDB.QueryBuilder().Where("migrationId", #eq(#Text(input.migrationId))).Where("sourceTable", #eq(#Text(input.sourceTable))).Where("chunk", #eq(#Nat(Nat64.toNat(input.chunk)))).Limit(2))) {
            case (#err(_)) #storageError;
            case (#ok(chunkResult)) {
              if (chunkResult.documents.size() != 0) #conflict else {
                switch (store.insert(recordFor(input))) { case (#ok(_)) #acknowledged; case (#err(_)) #storageError };
              };
            };
          };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideIdempotentWrite(input, ?{ version = existing.version; contentHash = existing.contentHash });
        } else #conflict;
      };
    };
  };

  public func lookup(store : Store, logicalId : Text) : Observation {
    if (logicalId.size() == 0 or logicalId.size() > 512) return #conflict;
    for (character in logicalId.chars()) { if (character < '\u{20}' or character == '\u{7f}') return #conflict };
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) #absent else if (records.size() == 1) {
          let (_, existing, _) = records[0]; #present({ version = existing.version; contentHash = existing.contentHash });
        } else #conflict;
      };
    };
  };
};

