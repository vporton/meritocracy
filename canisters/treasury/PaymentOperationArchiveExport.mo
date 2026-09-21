import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Archive "PaymentOperationArchiveRecovery";
import Operation "PaymentOperationIntent";

/// Canonical, self-contained UTF-8 export envelope for one immutable payment
/// operation. This is a codec only: it has no actor state, archive transport,
/// signer, destination address, ledger call, or chain material. The enclosing
/// archive saga must retain and acknowledge its own hash tuple before a future
/// archive sink may accept these bytes.
module {
  public let format = "meritocracy-payment-operation-archive-v1";
  public let maxEncodedBytes : Nat = 8_192;

  func textField(value : Text) : Text {
    // Length prefixes make every field boundary unambiguous even when an
    // identifier contains punctuation. Text.size is deterministic in Motoko.
    Nat.toText(value.size()) # ":" # value;
  };

  func blobText(value : Blob) : Text {
    var encoded = "";
    for (byte in Blob.toArray(value).vals()) {
      encoded := encoded # Nat8.toText(byte) # ",";
    };
    encoded;
  };

  /// Equal valid immutable operations encode byte-identically. The output
  /// intentionally retains only the already-approved destination hash, never
  /// a destination address or any signing/transaction material.
  public func encode(input : Operation.Input) : ?Blob {
    if (not Operation.valid(input)) return null;
    let encoded = textField(format) # textField(input.logicalId) #
      textField(input.operationId) # textField(input.obligationId) #
      textField(input.assetId) # textField(Nat.toText(input.amountBaseUnits)) #
      textField(Nat8.toText(input.assetDecimals)) # textField(blobText(input.destinationHash)) #
      textField(Nat64.toText(input.desiredVersion)) # textField(blobText(input.contentHash));
    let bytes = Text.encodeUtf8(encoded);
    if (Blob.toArray(bytes).size() > maxEncodedBytes) return null;
    ?bytes;
  };

  /// A receipt may acknowledge only the same immutable operation/version/hash
  /// tuple. This codec never accepts a caller-supplied replacement tuple.
  public func tupleNamesOperation(tuple : Archive.ArchiveTuple, input : Operation.Input) : Bool {
    Archive.validTuple(tuple) and Operation.valid(input) and
    tuple.logicalId == input.logicalId and tuple.version == input.desiredVersion and
    tuple.contentHash == input.contentHash;
  };

  /// Archive delivery binds the SHA-256 of this canonical envelope, rather
  /// than the private-store content hash. It can still name only the exact
  /// immutable logical ID and version; the binding module re-derives bytes
  /// and hash before any acknowledgement.
  public func archiveTupleNamesOperation(tuple : Archive.ArchiveTuple, input : Operation.Input) : Bool {
    Archive.validTuple(tuple) and Operation.valid(input) and
    tuple.logicalId == input.logicalId and tuple.version == input.desiredVersion;
  };
};
