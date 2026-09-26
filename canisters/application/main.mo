import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import StorageCatalog "../shared/StorageCatalog";
import StorageTypes "../shared/StorageTypes";
import IdentityRoleIntent "../core/IdentityRoleIntent";
import RoleAssignmentIntent "../core/RoleAssignmentIntent";
import CompletionReceiptIntent "../workflow/CompletionReceiptIntent";
import MigrationReceiptIntent "../archive_router/MigrationReceiptIntent";
import IdentityRoleStore "EmbeddedIdentityRoleStore";
import WorkflowReceiptStore "EmbeddedWorkflowCompletionReceiptStore";
import MigrationReceiptStore "EmbeddedMigrationReceiptStore";
import TreasuryOperationOutboxStore "EmbeddedTreasuryOperationOutboxStore";
import CallerAuthorization "CallerAuthorization";
import KycCallbackCorrelation "KycCallbackCorrelation";

/// Consolidated application actor.
///
/// This replaces the prior core, workflow, archive-router, evidence, and
/// storage-authority deployment boundaries. The imports are private module
/// contracts only: this M1 actor intentionally has no public method, generic
/// storage interface, runtime grant matrix, target data, or deployment state.
/// Later M1 work may add only narrowly typed application methods that
/// authenticate their caller and authorize the exact resource/action before
/// touching private in-process state.
persistent actor Application {
  // Compile-time contract anchors for the modules that now share this actor.
  // They deliberately create neither stable state nor Candid surface.
  type _StorageEnvelope = StorageTypes.Envelope;
  type _MutationIntent = StorageTypes.MutationIntentV1;
  type _IdentityBindingIntent = IdentityRoleIntent.BindingIntent;
  type _RoleIntent = RoleAssignmentIntent.RoleIntent;
  type _WorkflowReceiptIntent = CompletionReceiptIntent.Input;
  type _MigrationReceiptIntent = MigrationReceiptIntent.Input;
  type _CallerAuthorizationDecision = CallerAuthorization.Decision;

  // This is deliberately native persistent state, not a catalogue collection:
  // it is transient callback routing material, bounded to seven days, rather
  // than a retained KYC evidence record.  It has no Candid method and contains
  // only an opaque digest, principal binding, timestamps, and active state.
  // EOP upgrade initialization sweeps expiry before any future private use, so
  // restoring/upgrading cannot reactivate a stale correlation.
  var kycCallbackCorrelations : [KycCallbackCorrelation.Record] = [];
  var kycCallbackCleanupCursor : ?Nat = null;
  kycCallbackCorrelations := KycCallbackCorrelation.recover(kycCallbackCorrelations, Time.now());

  // Future authenticated initiation/callback methods must invoke these only
  // after binding the Candid caller to the trusted principal argument.  The callback path
  // first commits its independently idempotent minimum-attestation audit event,
  // then consumes the correlation immediately.  There is intentionally no
  // retained consumed-token receipt: duplicate provider events are deduped by
  // that durable audit-event journal, not by short-lived callback state.
  func _openPrivateKycCallbackCorrelation(
    digest : Text,
    principal : Principal,
  ) : KycCallbackCorrelation.OpenResult {
    let (result, next) = KycCallbackCorrelation.open(kycCallbackCorrelations, { digest; principal; nowNs = Time.now() });
    kycCallbackCorrelations := next;
    result;
  };

  func _consumePrivateKycCallbackCorrelation(
    digest : Text,
    principal : Principal,
  ) : KycCallbackCorrelation.ConsumeResult {
    let (result, next) = KycCallbackCorrelation.consumeAfterAttestationCommit(
      kycCallbackCorrelations,
      digest,
      principal,
      Time.now(),
    );
    kycCallbackCorrelations := next;
    result;
  };

  func _cleanupPrivateKycCallbackCorrelations() {
    let cursor = switch (kycCallbackCleanupCursor) { case (?value) value; case null 0 };
    let result = KycCallbackCorrelation.cleanup(
      kycCallbackCorrelations,
      cursor,
      KycCallbackCorrelation.maxCleanupBatch,
      Time.now(),
    );
    kycCallbackCorrelations := result.records;
    kycCallbackCleanupCursor := result.nextCursor;
  };

  let _storageLimits = StorageCatalog.limits;

  // M1-only private in-process collection scaffolding. No public method can
  // reach these stores, and their fixed adapters accept no caller-selected
  // collection/action. The initialized flags make an EOP reopen use the exact
  // collection names and schemas created on first install.
  let embeddedStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(Application),
    null,
  );

  var identityRoleCollectionsInitialized = false;
  transient let _identityRoleStore = switch (
    if (identityRoleCollectionsInitialized) {
      IdentityRoleStore.reopen(embeddedStore);
    } else {
      IdentityRoleStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private application identity/role collections");
  };
  identityRoleCollectionsInitialized := true;

  var workflowCompletionReceiptCollectionInitialized = false;
  transient let _workflowCompletionReceiptStore = switch (
    if (workflowCompletionReceiptCollectionInitialized) {
      WorkflowReceiptStore.reopen(embeddedStore);
    } else {
      WorkflowReceiptStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private application workflow receipt collection");
  };
  workflowCompletionReceiptCollectionInitialized := true;

  var migrationReceiptCollectionInitialized = false;
  transient let _migrationReceiptStore = switch (
    if (migrationReceiptCollectionInitialized) {
      MigrationReceiptStore.reopen(embeddedStore);
    } else {
      MigrationReceiptStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private application migration receipt collection");
  };
  migrationReceiptCollectionInitialized := true;

  // The sole cross-canister route has a private tuple-only outbox. It is not
  // reachable from Candid and carries no payment or destination material.
  var treasuryOperationOutboxCollectionInitialized = false;
  transient let _treasuryOperationOutboxStore = switch (
    if (treasuryOperationOutboxCollectionInitialized) {
      TreasuryOperationOutboxStore.reopen(embeddedStore);
    } else {
      TreasuryOperationOutboxStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null Runtime.trap("unable to open private application treasury-operation outbox collection");
  };
  treasuryOperationOutboxCollectionInitialized := true;
};
