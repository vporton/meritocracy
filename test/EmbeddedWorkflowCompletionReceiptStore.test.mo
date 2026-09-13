import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Store "../canisters/storage_authority/EmbeddedWorkflowCompletionReceiptStore";
import Receipt "../canisters/workflow/CompletionReceiptIntent";

func hash(byte : Nat8) : Blob { Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte })) };

let input : Receipt.Input = {
  logicalId = "workflow-completion:v1:embedded-17";
  cycleId = "cycle:embedded-17";
  operationName = "quarterly-result";
  desiredVersion = 1;
  contentHash = hash(2);
};

assert Store.validEncoding(input);
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(2) }) == #acknowledged;
assert Store.decideIdempotentWrite(input, ?{ version = 2; contentHash = hash(2) }) == #conflict;
assert Store.decideIdempotentWrite(input, ?{ version = 1; contentHash = hash(3) }) == #conflict;
assert Store.decideIdempotentWrite(input, null) == #conflict;
assert not Store.validEncoding({ input with contentHash = Blob.fromArray([1]) });
assert not Store.validEncoding({ input with cycleId = "bad\ncycle" });
