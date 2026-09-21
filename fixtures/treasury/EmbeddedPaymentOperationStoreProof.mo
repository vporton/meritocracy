// Disposable, synthetic-data-only proof of the treasury-owned private
// payment-operation adapter. It is not the target treasury canister.
import Principal "mo:base/Principal";
import Cycles "mo:base/ExperimentalCycles";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Embedded "../../canisters/treasury/EmbeddedPaymentOperationStore";
import PaymentOperation "../../canisters/treasury/PaymentOperationIntent";
import CycleReserve "../../canisters/shared/CycleReserve";

persistent actor this {
  // This deliberately mirrors the target treasury's private create/reopen
  // discipline. The fixture has no Candid method for any target treasury API.
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
    case null Runtime.trap("unable to open fixed synthetic treasury payment-operation collection");
  };
  collectionInitialized := true;

  // The fixture retains this bounded, immutable tuple before checking its
  // proof-only cycle reserve.  No caller can replace it or supply a resume
  // payload, including across an EOP-preserving upgrade.
  var pendingOperation : ?PaymentOperation.Input = null;
  // This fixed principal is only the disposable PocketIC installer used by
  // this fixture. It models an isolated repair boundary, not a treasury role,
  // controller, or production authorization policy.
  let repairPrincipal = Principal.fromText("kk5vc-iiifi");
  var repairRequired = false;

  func writePendingOperation() : Embedded.WriteResult {
    let ?input = pendingOperation else return #blocked;
    if (Cycles.balance() < CycleReserve.minimumReserve) return #blocked;
    let result = Embedded.write(store, input);
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { pendingOperation := null };
      case (#blocked) {};
    };
    result;
  };

  // Only this disposable proof method exists. It receives a destination hash,
  // never an address, signing key, transaction, receipt, ledger, or value.
  public func writeOperation(input : PaymentOperation.Input) : async Embedded.WriteResult {
    Embedded.write(store, input);
  };

  public func retainOperationThenWrite(input : PaymentOperation.Input) : async Embedded.WriteResult {
    if (pendingOperation != null or not PaymentOperation.valid(input)) return #blocked;
    pendingOperation := ?input;
    writePendingOperation();
  };

  // Models an interruption after durable immutable intent retention and before
  // the private write. It deliberately exposes no input-bearing resume path.
  public func retainOperationForOperatorRepair(input : PaymentOperation.Input) : async Embedded.WriteResult {
    if (pendingOperation != null or not PaymentOperation.valid(input)) return #blocked;
    pendingOperation := ?input;
    repairRequired := true;
    #blocked;
  };

  public func retryRetainedOperation() : async Embedded.WriteResult {
    if (repairRequired) return #blocked;
    writePendingOperation();
  };

  public shared ({ caller }) func repairRetainedOperation() : async Embedded.WriteResult {
    if (caller != repairPrincipal or not repairRequired) return #blocked;
    let result = writePendingOperation();
    switch (result) {
      case (#acknowledged or #conflict or #storageError) { repairRequired := false };
      case (#blocked) {};
    };
    result;
  };
};
