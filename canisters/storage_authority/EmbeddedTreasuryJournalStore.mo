import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import ZenDB "mo:zendb";
import TreasuryJournal "../treasury/TreasuryJournalIntent";

/// Private fixed persistence boundary for immutable treasury journal entries.
/// It stores no mutable balances, destination addresses, signing material,
/// transaction bytes, or chain receipts.  A later bounded balanced-set saga
/// remains responsible for accounting policy and activation.
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
    journalSequence : Nat64;
    operationId : Text;
    accountId : Text;
    assetId : Text;
    direction : TreasuryJournal.Direction;
    amountBaseUnits : Nat;
    assetDecimals : Nat8;
    version : Nat64;
    contentHash : Blob;
  };

  public type Store = ZenDB.Collection<Record>;

  let schema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text), ("journalSequence", #Nat64), ("operationId", #Text),
    ("accountId", #Text), ("assetId", #Text), ("direction", #Variant([("debit", #Null), ("credit", #Null)])),
    ("amountBaseUnits", #Nat), ("assetDecimals", #Nat8), ("version", #Nat64),
    ("contentHash", #Blob),
  ]);
  let candify : ZenDB.Types.Candify<Record> = {
    from_blob = func(blob : Blob) : ?Record { from_candid (blob) };
    to_blob = func(record : Record) : Blob { to_candid (record) };
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.createCollection<Record>(
      "treasury_journal_v1", schema, candify,
      ?{ schema_constraints = [#Unique(["logicalId"]), #Unique(["journalSequence"])] },
    ) else return null;
    ?collection;
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(collection) = db.getCollection<Record>("treasury_journal_v1", candify) else return null;
    ?collection;
  };

  func recordFor(input : TreasuryJournal.Input) : Record {
    {
      logicalId = input.logicalId; journalSequence = input.journalSequence;
      operationId = input.operationId; accountId = input.accountId; assetId = input.assetId;
      direction = input.direction; amountBaseUnits = input.amountBaseUnits;
      assetDecimals = input.assetDecimals; version = input.desiredVersion;
      contentHash = input.contentHash;
    };
  };

  /// `TreasuryJournalIntent` bounds text and hashes. The decimal Nat's 1,024
  /// digit cap leaves this canonical record well below the 256 KiB catalogue
  /// document limit without invoking generic Candid encoding in a pure guard.
  public func validEncoding(input : TreasuryJournal.Input) : Bool {
    TreasuryJournal.valid(input) and Nat.toText(input.amountBaseUnits).size() <= 1_024;
  };

  public func decideIdempotentWrite(
    input : TreasuryJournal.Input,
    observed : ?{ version : Nat64; contentHash : Blob },
  ) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (observed) {
      case (?(existing)) {
        if (existing.version == input.desiredVersion and existing.contentHash == input.contentHash) #acknowledged else #conflict;
      };
      case null #conflict;
    };
  };

  /// Insert once, or acknowledge only the exact durable version/hash tuple.
  /// The sequence uniqueness check prevents a second posting from claiming the
  /// same append position even if its logical ID differs.
  public func write(store : Store, input : TreasuryJournal.Input) : WriteResult {
    if (not validEncoding(input)) return #blocked;
    switch (store.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) #storageError;
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.search(ZenDB.QueryBuilder().Where("journalSequence", #eq(#Nat64(input.journalSequence))).Limit(2))) {
            case (#err(_)) #storageError;
            case (#ok(sequenceResult)) {
              if (sequenceResult.documents.size() != 0) #conflict else {
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

  /// A fixed, two-result-bounded tuple-only recovery lookup.
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
