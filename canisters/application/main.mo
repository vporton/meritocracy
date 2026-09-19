import Principal "mo:base/Principal";
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
};
