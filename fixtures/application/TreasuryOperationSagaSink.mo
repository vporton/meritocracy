// Disposable treasury-side inbox for the application saga proof. It opens the
// same treasury-owned private inbox adapter as the consolidated treasury, but
// remains a synthetic recovery fixture rather than treasury or custody code.
import Blob "mo:base/Blob";
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
    case null Runtime.trap("unable to open fixed synthetic treasury application inbox collection");
  };
  inboxCollectionInitialized := true;
  func onlyApplication(caller : Principal) { assert caller == application };

  public shared ({ caller }) func submit(input : Saga.Input) : async Receipt {
    onlyApplication(caller);
    if (not Inbox.validEncoding(input)) throw Error.reject("invalid synthetic treasury inbox tuple");
    let receipt : Receipt = { version = input.version; contentHash = input.contentHash };
    switch (Inbox.write(inboxStore, input)) {
      case (#acknowledged) receipt;
      case (#conflict) throw Error.reject("synthetic treasury inbox conflict");
      case (#blocked) throw Error.reject("invalid synthetic treasury inbox tuple");
      case (#storageError) throw Error.reject("synthetic treasury inbox storage failure");
    };
  };
  public shared ({ caller }) func lookup(logicalId : Text) : async ?Receipt {
    onlyApplication(caller);
    switch (Inbox.lookup(inboxStore, logicalId)) {
      case (#absent) null;
      case (#present(receipt)) ?receipt;
      case (#conflict) throw Error.reject("synthetic treasury inbox lookup conflict");
      case (#storageError) throw Error.reject("synthetic treasury inbox lookup failure");
    };
  };
  public shared ({ caller }) func count() : async Nat {
    onlyApplication(caller);
    // The recovery route has one fixed tuple and lookup is capped at two
    // documents, so this is only a tuple-presence observation.
    switch (Inbox.lookup(inboxStore, "application-outbox:v1:129")) {
      case (#absent) 0;
      case (#present(_)) 1;
      case (#conflict) throw Error.reject("synthetic treasury inbox count conflict");
      case (#storageError) throw Error.reject("synthetic treasury inbox count failure");
    };
  };
};
