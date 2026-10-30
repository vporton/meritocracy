/// Bounded, private, versioned storage primitives for owning Motoko actors.
///
/// This module deliberately exposes no actor or Candid surface.  An owning
/// actor keeps `State` in its persistent state and authenticates/authorizes
/// every method before it calls `put`.  The small bounds below are an M1
/// fixture foundation, not G2 collection sizing approval.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Result "mo:base/Result";
import Sha256 "mo:sha2/Sha256";

module {
  public let maxEntries : Nat = 128;
  public let maxCollectionChars : Nat = 64;
  public let maxLogicalIdChars : Nat = 256;
  public let maxPayloadBytes : Nat = 4_096;

  public type Entry = {
    collection : Text;
    logicalId : Text;
    version : Nat;
    contentHash : Blob;
    payload : Blob;
  };

  // This is deliberately a plain stable value: no HashMap object, iterator,
  // timer ID, or runtime capability is persisted across an actor upgrade.
  public type State = {
    schemaVersion : Nat;
    entries : [Entry];
  };

  public type PutResult = { #inserted; #duplicate };
  public type Error = {
    #invalidCollection;
    #invalidLogicalId;
    #invalidVersion;
    #payloadTooLarge;
    #contentHashMismatch;
    #capacityExceeded;
    #conflict;
  };

  public let empty : State = { schemaVersion = 1; entries = [] };

  func nonEmptyBounded(value : Text, maximum : Nat) : Bool {
    value.size() > 0 and value.size() <= maximum;
  };

  func sameKey(left : Entry, right : Entry) : Bool {
    left.collection == right.collection and left.logicalId == right.logicalId;
  };

  func sameValue(left : Entry, right : Entry) : Bool {
    left.version == right.version and Blob.equal(left.contentHash, right.contentHash) and Blob.equal(left.payload, right.payload);
  };

  public func get(state : State, collection : Text, logicalId : Text) : ?Entry {
    for (entry in state.entries.vals()) {
      if (entry.collection == collection and entry.logicalId == logicalId) return ?entry;
    };
    null;
  };

  /// Insert one immutable logical record.  A repeated identical request is a
  /// no-op; any replacement tuple is a conflict and cannot overwrite history.
  public func put(state : State, entry : Entry) : Result.Result<(State, PutResult), Error> {
    if (not nonEmptyBounded(entry.collection, maxCollectionChars)) return #err(#invalidCollection);
    if (not nonEmptyBounded(entry.logicalId, maxLogicalIdChars)) return #err(#invalidLogicalId);
    if (entry.version == 0) return #err(#invalidVersion);
    if (entry.payload.size() > maxPayloadBytes) return #err(#payloadTooLarge);
    if (not Blob.equal(entry.contentHash, Sha256.fromBlob(#sha256, entry.payload))) return #err(#contentHashMismatch);

    for (existing in state.entries.vals()) {
      if (sameKey(existing, entry)) {
        if (sameValue(existing, entry)) return #ok((state, #duplicate));
        return #err(#conflict);
      };
    };
    if (state.entries.size() >= maxEntries) return #err(#capacityExceeded);
    #ok(({ schemaVersion = state.schemaVersion; entries = Array.append(state.entries, [entry]) }, #inserted));
  };
};
