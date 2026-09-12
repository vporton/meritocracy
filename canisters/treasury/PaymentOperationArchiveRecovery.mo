import Blob "mo:base/Blob";

/// Fixed M1 archive-acknowledgement rules for an immutable payment-operation
/// intent. The future archive saga may transport only this tuple: it must not
/// disclose an amount, asset, destination, obligation, signed bytes, or chain
/// receipt at this acknowledgement boundary. This module has no persistence,
/// actor, Candid surface, storage call, or chain call.
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

  /// A missing, malformed, or different receipt never activates a
  /// payment-operation intent. Retrying belongs to the durable treasury saga,
  /// which must retain this same tuple and must not make new operation or
  /// transaction material after an unknown result.
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
