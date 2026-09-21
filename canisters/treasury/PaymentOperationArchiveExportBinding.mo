import Blob "mo:base/Blob";
import Sha256 "mo:sha2@0.1/Sha256";
import Archive "PaymentOperationArchiveRecovery";
import Export "PaymentOperationArchiveExport";
import Operation "PaymentOperationIntent";

/// Fixes canonical archive bytes and their SHA-256 receipt tuple for one
/// immutable payment operation. This pure boundary has no actor state,
/// transport, destination address, signing material, ledger, or chain call.
module {
  public type Binding = {
    tuple : Archive.ArchiveTuple;
    bytes : Blob;
  };

  public func prepare(input : Operation.Input) : ?Binding {
    let ?bytes = Export.encode(input) else return null;
    let tuple = {
      logicalId = input.logicalId;
      version = input.desiredVersion;
      contentHash = Sha256.fromBlob(#sha256, bytes);
    };
    if (not Export.archiveTupleNamesOperation(tuple, input)) return null;
    ?{ tuple; bytes };
  };

  /// Recovery re-derives the complete immutable pair and fails closed on
  /// altered operation material, archive bytes, or archive receipt hash.
  public func matches(input : Operation.Input, binding : Binding) : Bool {
    let ?expected = prepare(input) else return false;
    expected.tuple == binding.tuple and expected.bytes == binding.bytes;
  };
};
