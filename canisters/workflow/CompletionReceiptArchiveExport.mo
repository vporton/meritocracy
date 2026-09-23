import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Receipt "CompletionReceiptIntent";

/// Canonical, metadata-only archive envelope for one immutable workflow
/// completion receipt. This is a pure codec: it owns no workflow result,
/// provider response, actor state, archive transport, or public API.
module {
  public let format = "meritocracy-workflow-completion-receipt-archive-v1";
  public let maxEncodedBytes : Nat = 4_096;

  func textField(value : Text) : Text {
    // Prefix every field so identifiers with punctuation cannot introduce an
    // ambiguous archive representation.
    Nat.toText(value.size()) # ":" # value;
  };

  func blobText(value : Blob) : Text {
    var encoded = "";
    for (byte in Blob.toArray(value).vals()) {
      encoded := encoded # Nat8.toText(byte) # ",";
    };
    encoded;
  };

  /// Equal valid receipt metadata encodes byte-identically. The completion
  /// result and every provider/intermediate value intentionally remain out of
  /// this receipt-only archive envelope.
  public func encode(input : Receipt.Input) : ?Blob {
    if (not Receipt.valid(input)) return null;
    let encoded = textField(format) # textField(input.logicalId) #
      textField(input.cycleId) # textField(input.operationName) #
      textField(Nat64.toText(input.desiredVersion)) #
      textField(blobText(input.contentHash));
    let bytes = Text.encodeUtf8(encoded);
    if (Blob.toArray(bytes).size() > maxEncodedBytes) return null;
    ?bytes;
  };

  /// A future archive receipt can name only this immutable completion tuple.
  /// Its archive-byte hash is deliberately established by a later binding
  /// contract, rather than trusting the private-store content hash as proof
  /// of delivery.
  public func tupleNamesReceipt(
    logicalId : Text,
    version : Nat64,
    contentHash : Blob,
    input : Receipt.Input,
  ) : Bool {
    Receipt.valid(input) and logicalId == input.logicalId and
    version == input.desiredVersion and Blob.equal(contentHash, input.contentHash);
  };

  /// Archive delivery instead acknowledges SHA-256 of the canonical envelope.
  /// The envelope hash is intentionally different from the private receipt
  /// content hash, but it may still name only this immutable identity/version.
  public func archiveTupleNamesReceipt(
    logicalId : Text,
    version : Nat64,
    archiveHash : Blob,
    input : Receipt.Input,
  ) : Bool {
    Receipt.valid(input) and logicalId == input.logicalId and
    version == input.desiredVersion and Blob.toArray(archiveHash).size() == 32;
  };
};
