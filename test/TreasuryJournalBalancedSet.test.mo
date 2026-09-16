import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Set "../canisters/treasury/TreasuryJournalBalancedSet";
import Journal "../canisters/treasury/TreasuryJournalIntent";

func hash(byte : Nat8) : Blob {
  Blob.fromArray(Array.tabulate<Nat8>(32, func(_ : Nat) : Nat8 { byte }));
};

func entry(id : Text, sequence : Nat64, direction : Journal.Direction, amount : Nat) : Journal.Input {
  {
    logicalId = id;
    journalSequence = sequence;
    operationId = "operation:balanced-synthetic";
    accountId = if (direction == #debit) "treasury:available" else "treasury:liability";
    assetId = "icrc1:ledger:TEST";
    direction;
    amountBaseUnits = amount;
    assetDecimals = 8;
    desiredVersion = 1;
    contentHash = hash(Nat8.fromNat(Nat64.toNat(sequence)));
  };
};

let debit = entry("treasury-journal:v1:balanced-debit", 100, #debit, 125_000);
let credit = entry("treasury-journal:v1:balanced-credit", 101, #credit, 125_000);
let balanced : Set.Input = { logicalId = "treasury-journal-set:v1:balanced"; entries = [debit, credit] };

assert Set.valid(balanced);
assert Set.reconcile(
  balanced,
  [
    #present({ version = debit.desiredVersion; contentHash = debit.contentHash }),
    #present({ version = credit.desiredVersion; contentHash = credit.contentHash }),
  ],
) == #activate;

// Absence keeps every posting non-authoritative; a changed tuple conflicts.
assert Set.reconcile(balanced, [#absent, #present({ version = credit.desiredVersion; contentHash = credit.contentHash })]) == #remainPending;
assert Set.reconcile(balanced, [#present({ version = 2; contentHash = debit.contentHash }), #present({ version = credit.desiredVersion; contentHash = credit.contentHash })]) == #conflict;

assert not Set.valid({ balanced with entries = [debit, { credit with amountBaseUnits = 124_999 }] });
assert not Set.valid({ balanced with entries = [debit, { credit with journalSequence = debit.journalSequence }] });
assert not Set.valid({ balanced with entries = [debit, { credit with operationId = "operation:other" }] });
assert not Set.valid({ balanced with entries = [debit] });
assert Set.reconcile(balanced, [#present({ version = debit.desiredVersion; contentHash = debit.contentHash })]) == #blocked;
