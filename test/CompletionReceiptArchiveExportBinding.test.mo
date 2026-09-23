import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Binding "../canisters/workflow/CompletionReceiptArchiveExportBinding";
import Receipt "../canisters/workflow/CompletionReceiptIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

let receipt : Receipt.Input = {
  logicalId = "workflow-completion:v1:archive-binding:quarterly-17";
  cycleId = "cycle:quarterly-17";
  operationName = "publish-quarterly-result";
  desiredVersion = 1;
  contentHash = hash(9);
};

let ?binding = Binding.prepare(receipt) else { assert false; loop {} };
assert Binding.matches(receipt, binding);
assert not Binding.matches({ receipt with cycleId = "cycle:quarterly-18" }, binding);
assert not Binding.matches({ receipt with operationName = "publish-repeat-result" }, binding);
assert not Binding.matches({ receipt with contentHash = hash(10) }, binding);
assert not Binding.matches(receipt, { binding with bytes = Blob.fromArray([1]) });
assert Binding.prepare({ receipt with operationName = "bad\noperation" }) == null;
