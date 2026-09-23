import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Archive "MigrationReceiptArchiveRecovery";
import Receipt "MigrationReceiptIntent";

/// Canonical, metadata-only archive envelope for one immutable import receipt.
///
/// This intentionally exports neither source rows nor connection data.  It is
/// a pure codec: a future authenticated importer/archive saga must separately
/// retain and acknowledge a SHA-256-bound archive tuple before delivery.
module {
  public let format = "meritocracy-migration-receipt-archive-v1";
  public let maxEncodedBytes : Nat = 8_192;

  func textField(value : Text) : Text {
    // Length prefixes make the field sequence unambiguous without parsing
    // source data or relying on punctuation in a legacy table name.
    Nat.toText(value.size()) # ":" # value;
  };

  func blobText(value : Blob) : Text {
    var encoded = "";
    for (byte in Blob.toArray(value).vals()) {
      encoded := encoded # Nat8.toText(byte) # ",";
    };
    encoded;
  };

  /// Equal valid receipt metadata encodes byte-identically. The payload and
  /// content hashes bind the imported bytes without exposing any row value.
  public func encode(input : Receipt.Input) : ?Blob {
    if (not Receipt.valid(input)) return null;
    let encoded = textField(format) # textField(input.logicalId) #
      textField(input.migrationId) # textField(input.sourceTable) #
      textField(Nat64.toText(input.chunk)) # textField(Nat.toText(Nat32.toNat(input.rowCount))) #
      textField(blobText(input.payloadHash)) # textField(Nat64.toText(input.desiredVersion)) #
      textField(blobText(input.contentHash));
    let bytes = Text.encodeUtf8(encoded);
    if (Blob.toArray(bytes).size() > maxEncodedBytes) return null;
    ?bytes;
  };

  /// A receipt acknowledgement names only its retained immutable identity.
  /// It cannot acknowledge a replacement chunk with coincident hashes.
  public func tupleNamesReceipt(tuple : Archive.ArchiveTuple, input : Receipt.Input) : Bool {
    Archive.validTuple(tuple) and Receipt.valid(input) and tuple.logicalId == input.logicalId and
    tuple.version == input.desiredVersion and Blob.equal(tuple.contentHash, input.contentHash);
  };

  /// Archive delivery acknowledges the SHA-256 of the canonical envelope,
  /// rather than the private receipt content hash. It still names only this
  /// immutable logical ID and version.
  public func archiveTupleNamesReceipt(tuple : Archive.ArchiveTuple, input : Receipt.Input) : Bool {
    Archive.validTuple(tuple) and Receipt.valid(input) and
    tuple.logicalId == input.logicalId and tuple.version == input.desiredVersion;
  };
};
