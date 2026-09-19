import Blob "mo:base/Blob";
import ZenDB "mo:zendb";
import Receipt "../workflow/CompletionReceiptIntent";
import StorageCatalog "../shared/StorageCatalog";

/// Application-private fixed persistence boundary for workflow completion
/// receipts. It stores only a bounded immutable identity and recovery tuple:
/// no workflow payload, task input, provider response, or caller identity
/// crosses this boundary.
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
    cycleId : Text;
    operationName : Text;
    version : Nat64;
    contentHash : Blob;
  };
  public type Store = ZenDB.Collection<Record>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text), ("cycleId", #Text), ("operationName", #Text),
    ("version", #Nat64), ("contentHash", #Blob),
  ]);
  let candify : ZenDB.Types.Candify<Record> = {
    from_blob = func(blob : Blob) : ?Record { from_candid (blob) };
    to_blob = func(record : Record) : Blob { to_candid (record) };
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<Record>(
      "workflow_completion_receipt_v1", schema, candify,
      ?{ schema_constraints = [#Unique(["logicalId"]), #Unique(["cycleId", "operationName"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<Record>("workflow_completion_receipt_v1", candify) else return null;
    ?collection;
  };

  func recordFor(input : Receipt.Input) : Record {
    { logicalId = input.logicalId; cycleId = input.cycleId; operationName = input.operationName;
      version = input.desiredVersion; contentHash = input.contentHash };
  };

  public func validEncoding(input : Receipt.Input) : Bool {
    // Receipt text is bounded to 896 scalar values; even the maximum UTF-8
    // envelope plus its hash and Candid framing is below the fixed document cap.
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

  /// Insert only once. Either unique identity collision fails closed, except
  /// for exact replay of the retained logical-ID/version/hash tuple.
  public func write(store : Store, input : Receipt.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.search(ZenDB.QueryBuilder().Where("cycleId", #eq(#Text(input.cycleId))).Where("operationName", #eq(#Text(input.operationName))).Limit(2))) {
            case (#err(_)) #storageError;
            case (#ok(identityResult)) {
              if (identityResult.documents.size() != 0) #conflict else {
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

  /// Fixed two-result-bounded recovery lookup. The actor gates it to the
  /// workflow principal so it cannot become an existence oracle.
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

