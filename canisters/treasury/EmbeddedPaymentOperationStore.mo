import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import ZenDB "mo:zendb";
import PaymentOperation "PaymentOperationIntent";

/// Treasury-owned private persistence for immutable payment-operation tuples.
/// It has no actor or Candid surface and never stores a destination address,
/// signing material, transaction bytes, or chain receipt.
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
    operationId : Text;
    obligationId : Text;
    assetId : Text;
    amountBaseUnits : Nat;
    assetDecimals : Nat8;
    destinationHash : Blob;
    version : Nat64;
    contentHash : Blob;
  };
  public type Store = ZenDB.Collection<Record>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text), ("operationId", #Text), ("obligationId", #Text),
    ("assetId", #Text), ("amountBaseUnits", #Nat), ("assetDecimals", #Nat8),
    ("destinationHash", #Blob), ("version", #Nat64), ("contentHash", #Blob),
  ]);
  let candify : ZenDB.Types.Candify<Record> = {
    from_blob = func(blob : Blob) : ?Record { from_candid (blob) };
    to_blob = func(record : Record) : Blob { to_candid (record) };
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<Record>(
      "treasury_payment_operation_v1", schema, candify,
      ?{ schema_constraints = [#Unique(["logicalId"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<Record>("treasury_payment_operation_v1", candify) else return null;
    ?collection;
  };

  func recordFor(input : PaymentOperation.Input) : Record {
    {
      logicalId = input.logicalId; operationId = input.operationId;
      obligationId = input.obligationId; assetId = input.assetId;
      amountBaseUnits = input.amountBaseUnits; assetDecimals = input.assetDecimals;
      destinationHash = input.destinationHash; version = input.desiredVersion;
      contentHash = input.contentHash;
    };
  };

  public func validEncoding(input : PaymentOperation.Input) : Bool {
    PaymentOperation.valid(input) and Nat.toText(input.amountBaseUnits).size() <= 1_024;
  };

  public func decideIdempotentWrite(
    input : PaymentOperation.Input,
    observed : ?{ version : Nat64; contentHash : Blob },
  ) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (observed) {
      case null #conflict;
      case (?existing) {
        if (existing.version == input.desiredVersion and existing.contentHash == input.contentHash) #acknowledged else #conflict;
      };
    };
  };

  /// Insert once, or acknowledge only the exact durable version/hash tuple.
  public func write(store : Store, input : PaymentOperation.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.insert(recordFor(input))) { case (#ok(_)) #acknowledged; case (#err(_)) #storageError };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideIdempotentWrite(input, ?{ version = existing.version; contentHash = existing.contentHash });
        } else #conflict;
      };
    };
  };

  /// Fixed, two-result-bounded tuple-only recovery lookup.
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
