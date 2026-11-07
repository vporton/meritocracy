import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Nat32 "mo:base/Nat32";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Test "mo:test";
import Serialization "../canisters/rounds/Serialization";
import State "../canisters/rounds/State";
import Types "../canisters/rounds/Types";

func hex(value : Text) : Blob {
  let chars = value.chars();
  var bytes : [Nat8] = [];
  func nibble(c : Char) : Nat8 {
    let n = Char.toNat32(c);
    if (n >= 48 and n <= 57) Nat8.fromNat(Nat32.toNat(n - 48)) else Nat8.fromNat(Nat32.toNat(n - 87));
  };
  label parse loop {
    let ?a = chars.next() else break parse;
    let ?b = chars.next() else Debug.trap("odd hex");
    bytes := Array.append(bytes, [nibble(a) * 16 + nibble(b)]);
  };
  Blob.fromArray(bytes);
};
let hash = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0x33 }));
let asset : Types.AssetId = {
  ledger = Principal.fromText("2vxsx-fae");
  decimals = 8;
  symbol = "ICP";
};
let draft : Types.AllocationDraft = {
  id = 7;
  user_id = 9;
  amount_atoms = 9_007_199_254_740_993;
  evidence_hash = hash;
};

Test.suite(
  "rounds serialization and state",
  func() {
    Test.test(
      "allocation version matches fixture",
      func() {
        assert Serialization.allocationVersion(42, asset, [{ draft; recipient_hash = null }]) == #ok(hex("58ed35c11097aee9d88a5f3ad83d13a5110706cb386383b9372ac8a59a95e19d"));
      },
    );
    Test.test(
      "CAS, disputes, retries, completion and snapshot",
      func() {
        let store = State.Store(Types.emptyState);
        let #ok(round) = store.createDraft(asset, hash, 10, hash) else Debug.trap("draft");
        let drafts : [Types.AllocationDraft] = [{ id = 2; user_id = 2; amount_atoms = 4; evidence_hash = hash }, { id = 1; user_id = 1; amount_atoms = 6; evidence_hash = hash }];
        let #ok(version) = store.putAllocationVersion(round.id, null, drafts, 1) else Debug.trap("version");
        assert store.putAllocationVersion(round.id, null, drafts, 2) == #err(#conflict("allocation version compare-and-swap failed"));
        ignore store.markFunded(round.id, 12);
        let account : Types.Account = {
          owner = Principal.fromText("2vxsx-fae");
          subaccount = null;
        };
        let #ok(finalized) = store.finalize(round.id, [{ allocation_id = 1; disposition = #pay({ account; recipient_hash = hash }) }, { allocation_id = 2; disposition = #carry("no route") }], 20, 10) else Debug.trap("finalize");
        assert finalized.allocation_version != ?version;
        let #ok(dispute) = store.fileDispute(round.id, 1, hash, "proof", 11) else Debug.trap("dispute");
        assert store.getDispute(dispute.id) == ?dispute;
        assert store.allDisputes().size() == 1;
        ignore store.resolveDispute(dispute.id, #reject);
        ignore store.startExecution(round.id, 20);
        assert store.prepareExecutionTimestamp(round.id, 100) == #ok(());
        ignore store.markExecuting(round.id, 1);
        ignore store.markRetryable(round.id, 1, "temporarily unavailable");
        let before = store.roundAllocations(round.id)[0].recipient;
        ignore store.markExecuting(round.id, 1);
        assert store.roundAllocations(round.id)[0].recipient == before;
        ignore store.markPaid(round.id, 1, 77);
        assert switch (store.complete(round.id, true)) {
          case (#ok(done)) done.status == #complete;
          case _ false;
        };
        let restored = State.Store(store.snapshot());
        assert restored.getRound(round.id) != null;
        let #ok(otherRound) = restored.createDraft(asset, hash, 1, hash) else Debug.trap("second draft");
        assert restored.putAllocationVersion(otherRound.id, null, [{ id = 1; user_id = 9; amount_atoms = 1; evidence_hash = hash }], 30) == #err(#conflict("allocation id is already used by another round"));
        let #ok(targetRound) = restored.createDraft(asset, hash, 1, hash) else Debug.trap("target draft");
        let #ok(targetVersion) = restored.putAllocationVersion(targetRound.id, null, [{ id = 20; user_id = 2; amount_atoms = 1; evidence_hash = hash }], 30) else Debug.trap("target version");
        assert restored.bindRollover({
          source_allocation_id = 2;
          source_round = round.id;
          target_round = targetRound.id;
          target_allocation_id = 20;
          target_allocation_version = targetVersion;
        }) == #ok({
          source_allocation_id = 2;
          source_round = round.id;
          target_round = targetRound.id;
          target_allocation_id = 20;
          target_allocation_version = targetVersion;
        });
        assert restored.getRolloverBinding(2) == ?{
          source_allocation_id = 2;
          source_round = round.id;
          target_round = targetRound.id;
          target_allocation_id = 20;
          target_allocation_version = targetVersion;
        };
        assert switch (restored.putAllocationVersion(targetRound.id, ?targetVersion, [{ id = 20; user_id = 2; amount_atoms = 1; evidence_hash = hash }], 31)) {
          case (#err(#conflict(_))) true;
          case _ false;
        };
        let #ok(frozenRound) = restored.createDraft(asset, hash, 1, hash) else Debug.trap("frozen draft");
        ignore restored.putAllocationVersion(frozenRound.id, null, [{ id = 3; user_id = 3; amount_atoms = 1; evidence_hash = hash }], 31);
        ignore restored.markFunded(frozenRound.id, 2);
        ignore restored.finalize(frozenRound.id, [{ allocation_id = 3; disposition = #pay({ account; recipient_hash = hash }) }], 50, 40);
        let #ok(frozenDispute) = restored.fileDispute(frozenRound.id, 3, hash, "proof", 41) else Debug.trap("frozen dispute");
        ignore restored.resolveDispute(frozenDispute.id, #uphold);
        assert switch (restored.settleUpheldFrozen(frozenDispute.id, "governance carried")) {
          case (#ok(value)) value.execution == #carried("governance carried");
          case _ false;
        };
      },
    );
  },
);
