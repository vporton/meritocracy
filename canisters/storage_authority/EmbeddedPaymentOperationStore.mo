import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import ZenDB "mo:zendb";
import PaymentOperation "../treasury/PaymentOperationIntent";

/// The fixed embedded payment-operation collection boundary for the M1
/// treasury proof.  It has no actor or Candid surface.  In particular it does
/// not receive a destination address, signing material, transaction bytes, or
/// chain receipt: the only destination representation is the immutable hash
/// already validated by `PaymentOperationIntent`.
module {
  public type WriteResult = {
    #acknowledged;
    #blocked;
    #conflict;
    #storageError;
  };
  /// The treasury needs only its durable intent's exact tuple to reconcile a
  /// lost reply. This cannot disclose operation details or chain material.
  public type Observation = {
    #absent;
    #present : { version : Nat64; contentHash : Blob };
    #conflict;
    #storageError;
  };

  type PaymentOperationRecord = {
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

  public type Store = ZenDB.Collection<PaymentOperationRecord>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("operationId", #Text),
    ("obligationId", #Text),
    ("assetId", #Text),
    ("amountBaseUnits", #Nat),
    ("assetDecimals", #Nat8),
    ("destinationHash", #Blob),
    ("version", #Nat64),
    ("contentHash", #Blob),
  ]);

  let candify : ZenDB.Types.Candify<PaymentOperationRecord> = {
    from_blob = func(blob : Blob) : ?PaymentOperationRecord {
      from_candid (blob);
    };
    to_blob = func(record : PaymentOperationRecord) : Blob {
      to_candid (record);
    };
  };

  /// This opens one named collection only. Its unique logical-ID index is the
  /// reconciliation boundary; no caller can select an alternate collection or
  /// query shape.
  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<PaymentOperationRecord>(
      "treasury_payment_operation_v1",
      schema,
      candify,
      ?{ schema_constraints = [#Unique(["logicalId"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<PaymentOperationRecord>(
      "treasury_payment_operation_v1",
      candify,
    ) else return null;
    ?collection;
  };

  func recordFor(input : PaymentOperation.Input) : PaymentOperationRecord {
    {
      logicalId = input.logicalId;
      operationId = input.operationId;
      obligationId = input.obligationId;
      assetId = input.assetId;
      amountBaseUnits = input.amountBaseUnits;
      assetDecimals = input.assetDecimals;
      destinationHash = input.destinationHash;
      version = input.desiredVersion;
      contentHash = input.contentHash;
    };
  };

  // Ensure the fixed record has a bounded canonical envelope without asking
  // the Mops interpreter to execute ZenDB's generic Candid decoder. The text
  // limits in `PaymentOperationIntent` bound all textual fields to at most
  // 1,664 scalar values; even four UTF-8 bytes each plus the two 32-byte
  // hashes and the 1,024-digit Nat ceiling remains far below the catalogue's
  // 262,144-byte document limit. This is intentionally not a write operation.
  public func validEncoding(input : PaymentOperation.Input) : Bool {
    PaymentOperation.valid(input) and Nat.toText(input.amountBaseUnits).size() <= 1_024;
  };

  /// Pure exact-tuple rule shared by the fixed write path and vectors. A
  /// caller cannot use it to turn an absent observation into acknowledgement.
  public func decideIdempotentWrite(
    input : PaymentOperation.Input,
    observed : ?{ version : Nat64; contentHash : Blob },
  ) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (observed) {
      case null #conflict;
      case (?existing) {
        if (existing.version == input.desiredVersion and existing.contentHash == input.contentHash) {
          #acknowledged;
        } else {
          #conflict;
        };
      };
    };
  };

  /// Insert once, or acknowledge only the exact version/hash already stored.
  /// A broken unique index fails closed; this never activates or sends value.
  public func write(store : Store, input : PaymentOperation.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    let record = recordFor(input);
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.insert(record)) {
            case (#ok(_)) #acknowledged;
            case (#err(_)) #storageError;
          };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideIdempotentWrite(input, ?{ version = existing.version; contentHash = existing.contentHash });
        } else {
          #conflict;
        };
      };
    };
  };

  /// A fixed, two-result-bounded tuple-only recovery lookup.
  public func lookup(store : Store, logicalId : Text) : Observation {
    if (logicalId.size() == 0 or logicalId.size() > 512) return #conflict;
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return #conflict;
    };
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          #absent;
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          #present({
            version = existing.version;
            contentHash = existing.contentHash;
          });
        } else {
          #conflict;
        };
      };
    };
  };
};
