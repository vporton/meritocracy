// Disposable low-cycle proof for the sole application-to-treasury tuple
// boundary.  It is not an application actor or a payment interface.
import Blob "mo:base/Blob";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import CycleReserve "../../canisters/shared/CycleReserve";
import Saga "../../canisters/application/TreasuryOperationSaga";
import Outbox "../../canisters/application/EmbeddedTreasuryOperationOutboxStore";

shared ({ caller = installer }) persistent actor class (operator : Principal, treasuryId : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(operator);
  let treasury : actor {
    submit : shared Saga.Input -> async Receipt;
    lookup : shared Text -> async ?Receipt;
    count : shared () -> async Nat;
  } = actor (Principal.toText(treasuryId));
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(Principal.fromActor(this), null);
  var outboxCollectionInitialized = false;
  transient let outboxStore = switch (if (outboxCollectionInitialized) {
    Outbox.reopen(stableStore);
  } else {
    Outbox.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic application treasury outbox collection");
  };
  outboxCollectionInitialized := true;
  var retained : ?Saga.Intent = null;
  // A fixed fixture-only principal keeps the interrupted repair route distinct
  // from the ordinary application operator. It is not a target role or grant.
  let repairPrincipal = Principal.fromText("xs6im-qieam");
  var repairRequired = false;

  func onlyOperator(caller : Principal) { assert caller == operator };
  func dispatchRetained() : async Bool {
    let ?saved = retained else return false;
    if (Cycles.balance() < CycleReserve.minimumReserve) return false;
    let receipt = await treasury.submit(saved.input);
    if (receipt.version != saved.input.version or receipt.contentHash != saved.input.contentHash) throw Error.reject("changed synthetic treasury receipt");
    retained := ?{ saved with phase = #acknowledged; active = true };
    true;
  };

  // The intent is durable before checking cycles.  Once retained, no method
  // accepts a replacement tuple; retry takes no input after replenishment.
  public shared ({ caller }) func retainThenTry(input : Saga.Input) : async Bool {
    onlyOperator(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic application treasury tuple");
    switch (retained) {
      case null {
        switch (Outbox.write(outboxStore, prepared.input)) {
          case (#acknowledged) {};
          case (_) throw Error.reject("synthetic private application outbox write failed");
        };
        retained := ?prepared;
      };
      case (?saved) {
        if (saved.input != prepared.input and not saved.active) throw Error.reject("immutable synthetic outbox intent");
        if (saved.input != prepared.input) retained := ?prepared;
      };
    };
    await dispatchRetained();
  };
  public shared ({ caller }) func retryRetained() : async Bool { onlyOperator(caller); await dispatchRetained() };
  // This represents interruption after the immutable outbox tuple has been
  // retained but before its treasury await. Ordinary retry is then closed;
  // repair is tuple-free and can dispatch only the retained tuple.
  public shared ({ caller }) func retainForOperatorRepair(input : Saga.Input) : async Bool {
    onlyOperator(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic application treasury tuple");
    switch (retained) {
      case null {
        switch (Outbox.write(outboxStore, prepared.input)) {
          case (#acknowledged) {};
          case (_) throw Error.reject("synthetic private application outbox write failed");
        };
        retained := ?prepared;
      };
      case (?saved) {
        if (saved.input != prepared.input and not saved.active) throw Error.reject("immutable synthetic outbox intent");
        if (saved.input != prepared.input) retained := ?prepared;
      };
    };
    repairRequired := true;
    false;
  };
  public shared ({ caller }) func repairRetained() : async Bool {
    if (caller != repairPrincipal or not repairRequired) throw Error.reject("synthetic operator repair denied");
    let repaired = await dispatchRetained();
    if (repaired) repairRequired := false;
    repaired;
  };
  // A repair reply is no more authoritative than an ordinary delivery reply.
  // Leave the retained tuple pending across the await and require the fixed
  // inbox lookup to acknowledge it later.  This deliberately traps after a
  // successful synthetic reply, modelling a reply that the caller cannot use.
  public shared ({ caller }) func repairThenLoseReply() : async () {
    if (caller != repairPrincipal or not repairRequired) throw Error.reject("synthetic operator repair denied");
    let ?saved = retained else throw Error.reject("missing synthetic outbox intent");
    if (Cycles.balance() < CycleReserve.minimumReserve) throw Error.reject("synthetic reserve unavailable");
    retained := ?Saga.startTreasuryCall(saved);
    let receipt = await treasury.submit(saved.input);
    if (receipt.version != saved.input.version or receipt.contentHash != saved.input.contentHash) {
      throw Error.reject("changed synthetic treasury receipt");
    };
    throw Error.reject("deliberately lost synthetic repair reply");
  };
  public shared ({ caller }) func reconcileRepair() : async Bool {
    if (caller != repairPrincipal or not repairRequired) throw Error.reject("synthetic operator repair denied");
    let ?saved = retained else throw Error.reject("missing synthetic outbox intent");
    let (updated, decision) = Saga.reconcile(Saga.lostReply(saved), switch (await treasury.lookup(saved.input.logicalId)) {
      case null #absent;
      case (?receipt) #present(receipt);
    });
    retained := ?updated;
    if (decision == #acknowledge) repairRequired := false;
    decision == #acknowledge;
  };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await treasury.count() };
};
