import Blob "mo:base/Blob";

/// Fixed M1 acknowledgement rules for archiving one immutable balanced
/// treasury-journal set. This is deliberately a tuple-only boundary: an
/// archive receipt cannot carry a balance, account, asset, amount, payout
/// destination, signer, transaction, or chain receipt.
///
/// A future persistent treasury actor must retain this exact tuple before its
/// archive await. Archiving is a copy/reconciliation concern, never evidence
/// that permits deletion, replacement, or activation of a journal set.
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

  /// Only an exact, valid receipt acknowledges the already-retained archive
  /// tuple. A missing or competing receipt remains pending; malformed input
  /// fails closed. Neither result authorizes a mutable journal projection.
  public func decide(expected : ArchiveTuple, receipt : ?ArchiveTuple) : ArchiveDecision {
    if (not validTuple(expected)) return #blocked;
    switch (receipt) {
      case null #remainPending;
      case (?observed) {
        if (not validTuple(observed)) {
          #blocked;
        } else if (observed.logicalId == expected.logicalId and observed.version == expected.version and observed.contentHash == expected.contentHash) {
          #acknowledge;
        } else {
          #remainPending;
        };
      };
    };
  };
};
