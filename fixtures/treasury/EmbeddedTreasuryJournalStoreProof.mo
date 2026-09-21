// Disposable, synthetic-data-only proof of the treasury-owned private journal
// adapter. This is not the target treasury canister.
import Runtime "mo:core@2.4/Runtime";
import Principal "mo:base/Principal";
import Cycles "mo:base/ExperimentalCycles";
import ZenDB "mo:zendb";
import Embedded "../../canisters/treasury/EmbeddedTreasuryJournalStore";
import TreasuryJournal "../../canisters/treasury/TreasuryJournalIntent";
import BalancedSet "../../canisters/treasury/TreasuryJournalBalancedSet";
import CycleReserve "../../canisters/shared/CycleReserve";

persistent actor this {
  // Mirror the target actor's private create/reopen discipline. No target
  // treasury API, balance, address, signer, or transfer is exposed here.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this), null,
  );
  var collectionInitialized = false;
  transient let store = switch (if (collectionInitialized) {
    Embedded.reopen(stableStore);
  } else {
    Embedded.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic treasury journal collection");
  };
  collectionInitialized := true;

  // The fixture retains this bounded immutable posting before checking its
  // proof-only cycle reserve. No caller can replace it or supply a resume
  // payload, including across an EOP-preserving upgrade.
  var pendingJournal : ?TreasuryJournal.Input = null;
  // This fixed principal is only the disposable PocketIC installer used by
  // this fixture. It models an isolated repair boundary, not a treasury role,
  // controller, or production authorization policy.
  let repairPrincipal = Principal.fromText("kk5vc-iiifi");
  var repairRequired = false;

  func writePendingJournal() : Embedded.WriteResult {
    let ?input = pendingJournal else return #blocked;
    if (Cycles.balance() < CycleReserve.minimumReserve) return #blocked;
    let result = Embedded.write(store, input);
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { pendingJournal := null };
      case (#blocked) {};
    };
    result;
  };

  // This fixture accepts one synthetic immutable posting only. The caller
  // receives no lookup, generic storage, or journal-set surface.
  public func writeJournal(input : TreasuryJournal.Input) : async Embedded.WriteResult {
    Embedded.write(store, input);
  };

  // This bounded synthetic set route is deliberately not a balance
  // projection or a target treasury operation. It validates both immutable
  // sides before the first private write, then accepts only exact retries of
  // either retained posting through the fixed adapter.
  public func writeBalancedSet(input : BalancedSet.Input) : async Embedded.WriteResult {
    if (not BalancedSet.valid(input)) return #blocked;
    for (entry in input.entries.vals()) {
      switch (Embedded.write(store, entry)) {
        case (#acknowledged) {};
        case (result) return result;
      };
    };
    #acknowledged;
  };

  public func retainJournalThenWrite(input : TreasuryJournal.Input) : async Embedded.WriteResult {
    if (pendingJournal != null or not TreasuryJournal.valid(input)) return #blocked;
    pendingJournal := ?input;
    writePendingJournal();
  };

  // Models an interruption after durable immutable intent retention and before
  // the private write. It deliberately exposes no input-bearing resume path.
  public func retainJournalForOperatorRepair(input : TreasuryJournal.Input) : async Embedded.WriteResult {
    if (pendingJournal != null or not TreasuryJournal.valid(input)) return #blocked;
    pendingJournal := ?input;
    repairRequired := true;
    #blocked;
  };

  public func retryRetainedJournal() : async Embedded.WriteResult {
    if (repairRequired) return #blocked;
    writePendingJournal();
  };

  public shared ({ caller }) func repairRetainedJournal() : async Embedded.WriteResult {
    if (caller != repairPrincipal or not repairRequired) return #blocked;
    let result = writePendingJournal();
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { repairRequired := false };
      case (#blocked) {};
    };
    result;
  };
};
