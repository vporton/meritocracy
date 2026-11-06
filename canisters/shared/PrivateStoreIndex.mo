/// Bounded, non-authoritative secondary-index and collection-vN helpers.
///
/// An owning actor keeps this state alongside VersionedPrivateStore.State and
/// updates both in one message (with no await).  This module deliberately
/// contains no actor/Candid surface and never treats an index as authority:
/// each index hit is re-checked against the primary record and content hash.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Result "mo:base/Result";
import Store "VersionedPrivateStore";

module {
  public let maxIndexEntries : Nat = 256;
  public let maxPageSize : Nat = 32;
  public let maxMigrationBatch : Nat = 16;

  public type IndexEntry = {
    indexName : Text;
    indexKey : Text;
    collection : Text;
    logicalId : Text;
    version : Nat;
    contentHash : Blob;
  };

  /// This opaque value is actor-owned state, not a caller-supplied offset.
  /// Its query hash and version make it invalid outside the exact index query.
  public type Cursor = {
    formatVersion : Nat;
    queryHash : Blob;
    afterIndexKey : ?Text;
    afterLogicalId : ?Text;
  };

  public type Migration = {
    sourceCollection : Text;
    targetCollection : Text;
    sourceVersion : Nat;
    targetVersion : Nat;
    nextLogicalId : ?Text;
    completed : Bool;
  };

  public type State = { entries : [IndexEntry]; migration : ?Migration };
  public let empty : State = { entries = []; migration = null };

  public type Error = {
    #indexCapacityExceeded;
    #duplicateIndexKey;
    #invalidPageSize;
    #cursorMismatch;
    #migrationAlreadyActive;
    #invalidMigration;
    #primaryMissing;
    #primaryHashMismatch;
    #targetConflict;
  };

  func before(aKey : Text, aId : Text, bKey : Text, bId : Text) : Bool {
    aKey < bKey or (aKey == bKey and aId < bId);
  };

  func cursorAfter(cursor : Cursor, key : Text, id : Text) : Bool {
    switch (cursor.afterIndexKey, cursor.afterLogicalId) {
      case (?afterKey, ?afterId) before(afterKey, afterId, key, id);
      case _ true;
    };
  };

  public func addUnique(state : State, entry : IndexEntry) : Result.Result<State, Error> {
    for (existing in state.entries.vals()) {
      if (existing.indexName == entry.indexName and existing.indexKey == entry.indexKey) {
        if (existing.collection == entry.collection and existing.logicalId == entry.logicalId and existing.version == entry.version and Blob.equal(existing.contentHash, entry.contentHash)) return #ok(state);
        return #err(#duplicateIndexKey);
      };
    };
    if (state.entries.size() >= maxIndexEntries) return #err(#indexCapacityExceeded);
    #ok({ entries = Array.append(state.entries, [entry]); migration = state.migration });
  };

  public func page(state : State, indexName : Text, expectedQueryHash : Blob, cursor : Cursor, pageSize : Nat) : Result.Result<([IndexEntry], ?Cursor), Error> {
    if (pageSize == 0 or pageSize > maxPageSize) return #err(#invalidPageSize);
    if (cursor.formatVersion != 1 or not Blob.equal(cursor.queryHash, expectedQueryHash)) return #err(#cursorMismatch);
    var selected : [IndexEntry] = [];
    for (entry in state.entries.vals()) {
      if (entry.indexName == indexName and cursorAfter(cursor, entry.indexKey, entry.logicalId)) {
        // Bounded insertion sort avoids exposing storage order as cursor order.
        var at : Nat = 0;
        while (at < selected.size() and before(selected[at].indexKey, selected[at].logicalId, entry.indexKey, entry.logicalId)) at += 1;
        selected := Array.append(Array.subArray(selected, 0, at), Array.append([entry], Array.subArray(selected, at, selected.size() - at)));
      };
    };
    let result = Array.subArray(selected, 0, if (selected.size() < pageSize) selected.size() else pageSize);
    let next = if (selected.size() > result.size()) {
      let last = result[result.size() - 1];
      ?{ formatVersion = 1; queryHash = expectedQueryHash; afterIndexKey = ?last.indexKey; afterLogicalId = ?last.logicalId };
    } else null;
    #ok((result, next));
  };

  public func startMigration(state : State, sourceCollection : Text, targetCollection : Text, sourceVersion : Nat, targetVersion : Nat) : Result.Result<State, Error> {
    if (sourceCollection == targetCollection or sourceVersion == 0 or targetVersion == 0) return #err(#invalidMigration);
    switch (state.migration) { case (?_) #err(#migrationAlreadyActive); case null #ok({ entries = state.entries; migration = ?{ sourceCollection; targetCollection; sourceVersion; targetVersion; nextLogicalId = null; completed = false } }) };
  };

  /// Copy a bounded, deterministic batch.  Existing target records must have
  /// the exact same logical ID/version/hash; any other target is a conflict.
  public func migrateBatch(indexState : State, primary : Store.State) : Result.Result<(State, Store.State, Nat), Error> {
    let migration = switch (indexState.migration) { case (?value) value; case null return #err(#invalidMigration) };
    if (migration.completed) return #ok((indexState, primary, 0));
    var copied : Nat = 0;
    var next : ?Text = null;
    var updated = primary;
    label scan for (source in primary.entries.vals()) {
      if (source.collection == migration.sourceCollection) {
        switch (migration.nextLogicalId) { case (?after) { if (source.logicalId <= after) continue scan }; case null {} };
        if (copied >= maxMigrationBatch) { next := ?source.logicalId; break scan };
        let target : Store.Entry = { collection = migration.targetCollection; logicalId = source.logicalId; version = migration.targetVersion; contentHash = source.contentHash; payload = source.payload };
        switch (Store.get(updated, target.collection, target.logicalId)) {
          case (?existing) {
            if (existing.version != target.version or not Blob.equal(existing.contentHash, target.contentHash) or not Blob.equal(existing.payload, target.payload)) return #err(#targetConflict);
          };
          case null {
            switch (Store.put(updated, target)) { case (#ok((state, _))) { updated := state }; case (#err(#capacityExceeded)) return #err(#targetConflict); case (#err(_)) return #err(#primaryHashMismatch) };
          };
        };
        copied += 1;
      };
    };
    // `next` points to the first unprocessed record; checkpoint after the
    // last copied logical ID so replaying a committed batch is harmless.
    let checkpoint = if (copied == 0) migration.nextLogicalId else {
      var last : ?Text = null;
      for (entry in updated.entries.vals()) if (entry.collection == migration.targetCollection) last := ?entry.logicalId;
      last;
    };
    let done = next == null;
    #ok(({ entries = indexState.entries; migration = ?{ migration with nextLogicalId = checkpoint; completed = done } }, updated, copied));
  };
};
