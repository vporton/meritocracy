// Synthetic archive receiver for the M1 local ZenDB proof. It models a
// separately deployed archive boundary that rejects until an operator/test
// explicitly permits it. It is not a Meritocracy canister and stores only one
// synthetic receipt.

import Runtime "mo:core@2.4/Runtime";

persistent actor class ArchiveSink() = this {
  var permitted = false;
  var storedReceipt : ?(Text, Blob) = null;

  // This is a separate message so the preceding rejected archive call cannot
  // accidentally commit permission as part of its failed transaction.
  public func permit() : async () {
    assert (not permitted);
    permitted := true;
  };

  // The initial rejection is a real inter-canister failure. Once permitted,
  // this synthetic sink accepts exactly one logical archive receipt.
  public func archive(logicalId : Text, contentHash : Blob) : async () {
    if (not permitted) Runtime.trap("synthetic archive is unavailable");
    switch (storedReceipt) {
      case null { storedReceipt := ?(logicalId, contentHash) };
      case (?(storedLogicalId, storedHash)) {
        assert (storedLogicalId == logicalId);
        assert (storedHash == contentHash);
      };
    };
  };

  public query func receipt() : async ?(Text, Blob) { storedReceipt };
};
