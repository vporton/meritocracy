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
    from_blob = func(blob : Blob) : ?PaymentOperationRecord { from_candid (blob) };
    to_blob = func(record : PaymentOperationRecord) : Blob { to_candid (record) };
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

  /// Kept private to make the exact record encoding type-check now. A later
  /// fixed treasury-only write path must still implement durable journaling,
  /// duplicate/lost-reply reconciliation, archive activation, low-cycle, and
  /// repair/resume proofs before this collection can be authoritative.
  func _recordFor(input : PaymentOperation.Input) : PaymentOperationRecord {
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
    let _record = _recordFor(input);
    PaymentOperation.valid(input) and
    Nat.toText(input.amountBaseUnits).size() <= 1_024;
  };
};
