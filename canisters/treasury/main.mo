import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import PaymentStore "EmbeddedPaymentOperationStore";
import JournalStore "EmbeddedTreasuryJournalStore";
import ApplicationInboxStore "EmbeddedApplicationOperationInboxStore";

/// M1 unified treasury scaffold.
///
/// Treasury-owned payment-operation and journal collections now live in this
/// actor's private embedded store. There is no storage-authority call, Candid
/// storage method, signer, transfer, destination, balance projection, or
/// target data. Public financial behavior remains blocked by M1/G2/G3 proof.
persistent actor Treasury {
  let embeddedStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(Treasury),
    null,
  );

  var paymentOperationCollectionInitialized = false;
  transient let _paymentOperationStore = switch (
    if (paymentOperationCollectionInitialized) {
      PaymentStore.reopen(embeddedStore);
    } else {
      PaymentStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private treasury payment-operation collection");
  };
  paymentOperationCollectionInitialized := true;

  var treasuryJournalCollectionInitialized = false;
  transient let _treasuryJournalStore = switch (
    if (treasuryJournalCollectionInitialized) {
      JournalStore.reopen(embeddedStore);
    } else {
      JournalStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private treasury journal collection");
  };
  treasuryJournalCollectionInitialized := true;

  // The sole cross-canister route is retained locally as a tuple-only inbox.
  // It is not reachable from Candid and cannot contain payment material.
  var applicationInboxCollectionInitialized = false;
  transient let _applicationInboxStore = switch (
    if (applicationInboxCollectionInitialized) {
      ApplicationInboxStore.reopen(embeddedStore);
    } else {
      ApplicationInboxStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private treasury application inbox collection");
  };
  applicationInboxCollectionInitialized := true;
};
