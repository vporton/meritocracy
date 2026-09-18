import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import Archive "TreasuryJournalArchiveRecovery";
import BalancedSet "TreasuryJournalBalancedSet";
import Journal "TreasuryJournalIntent";

/// Canonical, self-contained UTF-8 export envelope for one immutable balanced
/// treasury-journal set. This is a codec only: it has no actor state, archive
/// transport, balance projection, or external-chain material. The enclosing
/// archive saga must retain and acknowledge its own hash tuple before a future
/// archive sink may accept these bytes.
module {
  public let format = "meritocracy-treasury-journal-archive-v1";
  public let maxEncodedBytes : Nat = 32_768;

  func textField(value : Text) : Text {
    // Text.size counts Unicode scalar values. Every field is length-prefixed,
    // so punctuation in a source identifier cannot alter the record boundary.
    Nat.toText(value.size()) # ":" # value;
  };

  func direction(value : Journal.Direction) : Text {
    switch (value) { case (#debit) "debit"; case (#credit) "credit" };
  };

  func entryText(value : Journal.Input) : Text {
    var hashText = "";
    for (byte in Blob.toArray(value.contentHash).vals()) {
      hashText := hashText # Nat8.toText(byte) # ",";
    };
    textField(value.logicalId) # textField(Nat64.toText(value.journalSequence)) #
    textField(value.operationId) # textField(value.accountId) # textField(value.assetId) #
    textField(direction(value.direction)) # textField(Nat.toText(value.amountBaseUnits)) #
    textField(Nat8.toText(value.assetDecimals)) # textField(Nat64.toText(value.desiredVersion)) #
    textField(hashText);
  };

  /// A fixed length-prefixed UTF-8 encoding retains the exact posting order.
  /// It is reproducible for equal immutable inputs, independent of any ZenDB
  /// representation, document ID, or compiler-specific Candid type table.
  public func encode(input : BalancedSet.Input) : ?Blob {
    if (not BalancedSet.valid(input)) return null;
    var encoded = textField(format) # textField(input.logicalId) # Nat.toText(input.entries.size()) # ":";
    for (entry in input.entries.vals()) {
      encoded := encoded # entryText(entry);
    };
    let bytes = Text.encodeUtf8(encoded);
    if (Blob.toArray(bytes).size() > maxEncodedBytes) return null;
    ?bytes;
  };

  /// A receipt tuple can name only the immutable set it is exporting.  Hash
  /// calculation/verification stays at the approved archive boundary; this
  /// codec never accepts a caller-supplied replacement posting or tuple.
  public func tupleNamesSet(tuple : Archive.ArchiveTuple, input : BalancedSet.Input) : Bool {
    Archive.validTuple(tuple) and BalancedSet.valid(input) and tuple.logicalId == input.logicalId;
  };
};
