import Blob "mo:base/Blob";

/// Fixed acknowledgement rules for a canonical workflow-completion receipt
/// archive. This pure contract carries only a tuple: it owns no completion
/// result, workflow state, archive transport, or public API.
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

  /// An unknown delivery result never activates a workflow completion receipt.
  /// Only the exact durable logical-ID/version/canonical-byte-hash tuple may
  /// acknowledge; malformed data blocks rather than becoming retry material.
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
