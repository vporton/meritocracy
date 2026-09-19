import StorageCatalog "../shared/StorageCatalog";
import StorageTypes "../shared/StorageTypes";
import IdentityRoleIntent "../core/IdentityRoleIntent";
import RoleAssignmentIntent "../core/RoleAssignmentIntent";
import CompletionReceiptIntent "../workflow/CompletionReceiptIntent";
import MigrationReceiptIntent "../archive_router/MigrationReceiptIntent";

/// Consolidated application actor.
///
/// This replaces the prior core, workflow, archive-router, evidence, and
/// storage-authority deployment boundaries. The imports are private module
/// contracts only: this M1 actor intentionally has no public method, generic
/// storage interface, runtime grant matrix, target data, or deployment state.
/// Later M1 work may add only narrowly typed application methods that
/// authenticate their caller and authorize the exact resource/action before
/// touching private in-process state.
persistent actor {
  // Compile-time contract anchors for the modules that now share this actor.
  // They deliberately create neither stable state nor Candid surface.
  type _StorageEnvelope = StorageTypes.Envelope;
  type _MutationIntent = StorageTypes.MutationIntentV1;
  type _IdentityBindingIntent = IdentityRoleIntent.BindingIntent;
  type _RoleIntent = RoleAssignmentIntent.RoleIntent;
  type _WorkflowReceiptIntent = CompletionReceiptIntent.Input;
  type _MigrationReceiptIntent = MigrationReceiptIntent.Input;

  let _storageLimits = StorageCatalog.limits;
};
