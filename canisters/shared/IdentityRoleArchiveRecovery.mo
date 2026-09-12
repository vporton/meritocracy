import Blob "mo:base/Blob";

/// Fixed M1 archive-acknowledgement rules for immutable identity and role
/// records. The later archive saga may transport only this tuple: it must not
/// use an archive acknowledgement to disclose a principal, OAuth evidence, or
/// role label. This module has no persistence, actor, or Candid surface.
module {
  public type ArchiveTuple = {
    logicalId : Text;
    version : Nat64;
    contentHash : Blob;
  };

  public type ArchiveDecision = {
    #acknowledge;
    #remainPending;
    #blocked;
  };

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

  /// A missing, malformed, or different receipt never activates the record.
  /// Retrying is intentionally left to the durable owner saga, which must
  /// retain the same tuple and never derive new archive material from input.
  public func decide(expected : ArchiveTuple, receipt : ?ArchiveTuple) : ArchiveDecision {
    if (not validTuple(expected)) return #blocked;
    switch (receipt) {
      case null #remainPending;
      case (?observed) {
        if (not validTuple(observed)) {
          #blocked;
        } else if (
          observed.logicalId == expected.logicalId and
          observed.version == expected.version and
          observed.contentHash == expected.contentHash
        ) {
          #acknowledge;
        } else {
          #remainPending;
        };
      };
    };
  };
};
