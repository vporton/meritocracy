// Disposable retained-before-await proof for canonical payment-operation
// archive bindings. This has no target Candid surface, payment transfer,
// address, signer, key, transaction, ledger, or chain call.
import Error "mo:base/Error";
import Cycles "mo:base/ExperimentalCycles";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Archive "../../canisters/treasury/PaymentOperationArchiveRecovery";
import Binding "../../canisters/treasury/PaymentOperationArchiveExportBinding";
import Embedded "../../canisters/treasury/EmbeddedPaymentOperationStore";
import Operation "../../canisters/treasury/PaymentOperationIntent";
import CycleReserve "../../canisters/shared/CycleReserve";

shared ({ caller = installer }) persistent actor class (operator : Principal, sinkId : Principal) = this {
  assert not Principal.isAnonymous(operator);
  let sink : actor {
    retain : shared Binding.Binding -> async Archive.ArchiveTuple;
    lookup : shared Text -> async ?Archive.ArchiveTuple;
    count : shared () -> async Nat;
  } = actor (Principal.toText(sinkId));

  // This disposable fixture opens the same private payment-operation adapter
  // as the consolidated treasury. No collection or stored operation is
  // exposed through Candid.
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this), null,
  );
  var collectionInitialized = false;
  transient let paymentOperationStore = switch (if (collectionInitialized) {
    Embedded.reopen(stableStore);
  } else {
    Embedded.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic payment-operation collection");
  };
  collectionInitialized := true;

  var retained : ?Binding.Binding = null;
  var acknowledged = false;

  func onlyOperator(caller : Principal) { assert caller == operator };
  // Proof-only reserve: the immutable canonical binding is durable before
  // this check, so a depleted fixture cannot make an archive dispatch.
  func requireCycleReserve() {
    assert CycleReserve.decide(Cycles.balance()) == #allowed;
  };
  func exact(expected : Binding.Binding, observed : ?Archive.ArchiveTuple) : Bool {
    switch (observed) { case (?value) value == expected.tuple; case null false };
  };

  // The binding is durable before the await. The reply is deliberately lost,
  // so callers can never activate merely because they attempted delivery.
  public shared ({ caller }) func retainThenLoseReply(input : Operation.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic payment-operation archive input");
    switch (retained) {
      case null {
        // The immutable operation must be durably accepted by the current
        // private adapter before its canonical archive binding can exist.
        // A failed/conflicting write leaves no dispatchable archive route.
        switch (Embedded.write(paymentOperationStore, input)) {
          case (#acknowledged) {};
          case (_) throw Error.reject("synthetic private payment-operation write failed");
        };
        retained := ?binding;
        acknowledged := false;
      };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic archive binding is immutable once retained");
      };
    };
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic archive returned a changed receipt");
    throw Error.reject("deliberately lost synthetic payment-operation archive reply");
  };

  // This accepts no replacement operation or archive bytes after an unknown
  // result. It can acknowledge only the sink's exact durable receipt.
  public shared ({ caller }) func reconcile() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?binding = retained else return #blocked;
    let result = if (exact(binding, await sink.lookup(binding.tuple.logicalId))) #acknowledge else #remainPending;
    if (result == #acknowledge) acknowledged := true;
    result;
  };

  // Duplicate transport has no input and therefore can only redeliver the
  // retained canonical byte/hash binding.
  public shared ({ caller }) func retryThenLoseReply() : async () {
    onlyOperator(caller);
    let ?binding = retained else throw Error.reject("missing synthetic payment-operation archive binding");
    requireCycleReserve();
    let receipt = await sink.retain(binding);
    if (receipt != binding.tuple) throw Error.reject("synthetic archive retry receipt changed");
    throw Error.reject("deliberately lost synthetic payment-operation archive retry reply");
  };

  // Models a durable interruption after retaining the canonical binding and
  // before any archive await. No replacement operation, bytes, or tuple can
  // enter the subsequent repair path.
  public shared ({ caller }) func retainThenTrapBeforeArchiveAwait(input : Operation.Input) : async () {
    onlyOperator(caller);
    let ?binding = Binding.prepare(input) else throw Error.reject("invalid synthetic payment-operation archive repair input");
    switch (retained) {
      case null {
        switch (Embedded.write(paymentOperationStore, input)) {
          case (#acknowledged) {};
          case (_) throw Error.reject("synthetic private payment-operation write failed");
        };
        retained := ?binding;
        acknowledged := false;
      };
      case (?existing) {
        if (existing != binding) throw Error.reject("synthetic archive binding is immutable once retained");
      };
    };
    throw Error.reject("deliberately interrupted before synthetic payment-operation archive await");
  };

  // This is operator-only and tuple-free. It first checks the exact retained
  // receipt; only absence permits re-delivery of that same durable binding.
  // A successful reply remains deliberately unknown until reconcile observes
  // the exact receipt, so operator action alone cannot activate the archive.
  public shared ({ caller }) func repairArchiveResume() : async Archive.ArchiveDecision {
    onlyOperator(caller);
    let ?binding = retained else return #blocked;
    switch (Archive.decide(binding.tuple, await sink.lookup(binding.tuple.logicalId))) {
      case (#acknowledge) {
        acknowledged := true;
        #acknowledge;
      };
      case (#blocked) #blocked;
      case (#remainPending) {
        requireCycleReserve();
        let receipt = await sink.retain(binding);
        if (receipt != binding.tuple) throw Error.reject("synthetic archive repair receipt changed");
        #remainPending;
      };
    };
  };

  public shared ({ caller }) func isAcknowledged() : async Bool { onlyOperator(caller); acknowledged };
  public shared ({ caller }) func retainedCount() : async Nat { onlyOperator(caller); await sink.count() };
};
