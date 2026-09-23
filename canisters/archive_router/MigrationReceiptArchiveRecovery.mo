import Blob "mo:base/Blob";

/// Fixed acknowledgement rules for a canonical migration-receipt archive.
/// This is deliberately a metadata-only pure contract: it owns neither an
/// archive transport nor an importer, source row, database connection, or
/// credential.
module {
  public type ArchiveTuple = {
    logicalId : Text;
    version : Nat64;
    contentHash : Blob;
  };

  public type ArchiveDecision = { #acknowledge; #remainPending; #blocked };

  func validLogicalId(logicalId : Text) : Bool {
    if (logicalId.size() == 0 or logicalId.size() > 512) return false;
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return false;
    };
    true;
  };

  public func validTuple(tuple : ArchiveTuple) : Bool {
    validLogicalId(tuple.logicalId) and Blob.toArray(tuple.contentHash).size() == 32;
  };

  /// Unknown delivery results remain pending. A valid receipt acknowledges
  /// only the exact retained logical-ID/version/archive-hash tuple.
  public func decide(expected : ArchiveTuple, receipt : ?ArchiveTuple) : ArchiveDecision {
    if (not validTuple(expected)) return #blocked;
    switch (receipt) {
      case null #remainPending;
      case (?observed) {
        if (not validTuple(observed)) #blocked else if (
          observed.logicalId == expected.logicalId and
          observed.version == expected.version and
          observed.contentHash == expected.contentHash
        ) #acknowledge else #remainPending;
      };
    };
  };
};
