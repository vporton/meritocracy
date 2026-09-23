// Disposable bounded treasury-inbox capacity fixture. It receives only the
// application boundary tuple; no payment, asset, address, or chain data.
import Array "mo:base/Array";
import Error "mo:base/Error";
import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import Saga "../../canisters/application/TreasuryOperationSaga";
import Inbox "../../canisters/treasury/EmbeddedApplicationOperationInboxStore";

shared ({ caller = installer }) persistent actor class (application : Principal) = this {
  type Receipt = { version : Nat64; contentHash : Blob };
  assert not Principal.isAnonymous(application);
  let stableStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(Principal.fromActor(this), null);
  var inboxCollectionInitialized = false;
  transient let inboxStore = switch (if (inboxCollectionInitialized) {
    Inbox.reopen(stableStore);
  } else {
    Inbox.create(stableStore);
  }) {
    case (?value) value;
    case null Runtime.trap("unable to open fixed synthetic treasury application inbox capacity collection");
  };
  inboxCollectionInitialized := true;
  func onlyApplication(caller : Principal) { assert caller == application };

  public shared ({ caller }) func submit(input : Saga.Input) : async Receipt {
    onlyApplication(caller);
    let ?prepared = Saga.prepare(input) else throw Error.reject("invalid synthetic treasury inbox capacity tuple");
    switch (Inbox.write(inboxStore, prepared.input)) {
      case (#acknowledged) { version = prepared.input.version; contentHash = prepared.input.contentHash };
      case (#conflict) throw Error.reject("synthetic treasury inbox capacity conflict");
      case (#blocked) throw Error.reject("invalid synthetic treasury inbox capacity tuple");
      case (#storageError) throw Error.reject("synthetic treasury inbox capacity storage failure");
    };
  };
  public shared ({ caller }) func count() : async Nat {
    onlyApplication(caller);
    // Capacity fixtures use only the fixed 32-entry test envelope.  This
    // bounded probe avoids exposing collection enumeration as fixture API.
    var found : Nat = 0;
    for (ordinal in Nat.range(0, 31)) {
      switch (Inbox.lookup(inboxStore, "application-outbox:v1:capacity:expected:" # ordinal.toText())) {
        case (#present(_)) found += 1;
        case (#absent) {};
        case (#conflict) throw Error.reject("synthetic treasury inbox capacity lookup conflict");
        case (#storageError) throw Error.reject("synthetic treasury inbox capacity lookup failure");
      };
      switch (Inbox.lookup(inboxStore, "application-outbox:v1:capacity:two_x:" # ordinal.toText())) {
        case (#present(_)) found += 1;
        case (#absent) {};
        case (#conflict) throw Error.reject("synthetic treasury inbox capacity lookup conflict");
        case (#storageError) throw Error.reject("synthetic treasury inbox capacity lookup failure");
      };
    };
    found;
  };
};
