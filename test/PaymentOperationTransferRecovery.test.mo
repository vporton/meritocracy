import Blob "mo:base/Blob";
import Transfer "../canisters/treasury/PaymentOperationTransferRecovery";
import Archive "../canisters/treasury/PaymentOperationArchiveRecovery";

func hash(byte : Nat8) : Blob { Blob.fromArray([byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte, byte]) };

let expected : Archive.ArchiveTuple = {
  logicalId = "payment-operation:v1:synthetic-transfer";
  version = 1;
  contentHash = hash(1);
};

assert Transfer.decide(expected, ?expected) == #acknowledge;
assert Transfer.decide(expected, null) == #remainPending;
assert Transfer.decide(expected, ?{ expected with version = 2 }) == #remainPending;
assert Transfer.decide(expected, ?{ expected with contentHash = hash(2) }) == #remainPending;
assert Transfer.decide({ expected with contentHash = Blob.fromArray([]) }, ?expected) == #blocked;
