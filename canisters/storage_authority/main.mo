import Principal "mo:base/Principal";
import Runtime "mo:core@2.4/Runtime";
import ZenDB "mo:zendb";
import StorageCatalog "../shared/StorageCatalog";
import EmbeddedIdentityRoleStore "EmbeddedIdentityRoleStore";
import IdentityRole "../shared/IdentityRoleRecovery";
import Policy "StorageAuthorityPolicy";

/// M1 storage-authority boundary scaffold.
///
/// This canister exposes only a bounded, collection-specific M1 surface. It
/// has no generic ZenDB, grant-management, collection, action, document-ID,
/// or filter API. The fixed identity/role methods below remain un-deployed
/// proof work and are not an authoritative-store claim.
shared ({ caller = installer }) persistent actor class (initialConfig : Policy.Config) = this {
  // This is deliberately a persistent private field, rather than an actor
  // constructor parameter captured by method closures. Upgrade calls still
  // carry an init argument for the actor class, but that argument must never
  // replace the installed caller matrix. There is no mutation endpoint.
  var config : Policy.Config = initialConfig;

  // The exact M1-pinned embedded store is private state of this actor.  It is
  // deliberately created without a collection, document, index, or public
  // storage method: the fixed probes below remain authorization-only until
  // the bounded mutation/recovery suite proves a particular collection.
  // In particular, no RemoteInstance/CanisterDB actor or ZenDB grant API is
  // reachable through this canister's Candid boundary.
  var embeddedStore : ZenDB.Types.VersionedStableStore = ZenDB.newStableStore(
    Principal.fromActor(this),
    null,
  );

  assert Policy.canInstall(config, installer);

  type ProbeResult = Policy.Decision;
  // These two fixed collections are the first bounded embedded-store surface.
  // They reopen on upgrade rather than recreating or replacing immutable
  // records. No caller can select a collection, index, document ID, or action.
  var identityRoleCollectionsInitialized = false;
  transient let identityRoleStore = switch (
    if (identityRoleCollectionsInitialized) {
      EmbeddedIdentityRoleStore.reopen(embeddedStore);
    } else {
      EmbeddedIdentityRoleStore.create(embeddedStore);
    }
  ) {
    case (?store) store;
    case null { Runtime.trap("unable to open fixed identity/role collections") };
  };
  identityRoleCollectionsInitialized := true;

  public type PolicyAudit = {
    core : Principal;
    workflow : Principal;
    treasury : Principal;
    archive : Principal;
    evidence : Principal;
    governance : Principal;
  };

  func probe(
    caller : Principal,
    owner : StorageCatalog.Owner,
    logicalId : Text,
  ) : ProbeResult {
    Policy.authorizeData(config, caller, owner, logicalId);
  };

  func coreDataAllowed(caller : Principal, logicalId : Text) : Bool {
    switch (Policy.authorizeData(config, caller, #core, logicalId)) {
      case (#allowed) true;
      case (_) false;
    };
  };

  /// Fixed principal-binding write. This is intentionally not a generic
  /// storage method: only the configured core actor may call it, and the
  /// adapter accepts immutable logical-ID/version/hash records only.
  public shared ({ caller }) func writeCorePrincipalBinding(
    input : IdentityRole.PrincipalBindingInput,
  ) : async EmbeddedIdentityRoleStore.WriteResult {
    if (not coreDataAllowed(caller, input.logicalId)) return #blocked;
    EmbeddedIdentityRoleStore.writeBinding(identityRoleStore, input);
  };

  /// Fixed recovery lookup for the principal-binding collection. An
  /// unauthorized caller gets `#conflict`, never an existence signal.
  public shared ({ caller }) func lookupCorePrincipalBinding(
    logicalId : Text,
  ) : async EmbeddedIdentityRoleStore.BindingObservation {
    if (not coreDataAllowed(caller, logicalId)) return #conflict;
    EmbeddedIdentityRoleStore.lookupBinding(identityRoleStore, logicalId);
  };

  /// Fixed role-assignment write. Role revocation remains a later immutable
  /// logical record; this endpoint cannot overwrite an existing assignment.
  public shared ({ caller }) func writeCoreRoleAssignment(
    input : IdentityRole.RoleAssignmentInput,
  ) : async EmbeddedIdentityRoleStore.WriteResult {
    if (not coreDataAllowed(caller, input.logicalId)) return #blocked;
    EmbeddedIdentityRoleStore.writeRole(identityRoleStore, input);
  };

  // These collection-specific methods are intentionally not a generic
  // `(collection, action, document)` interface. A future in-process ZenDB
  // call can be added only behind the matching, fixed collection/action
  // method. The caller cannot choose a collection or action from Candid.
  public shared ({ caller }) func coreUserReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreUserWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func corePrincipalBindingReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func corePrincipalBindingWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreProfileReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreProfileWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreEmailEvidenceReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreEmailEvidenceWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func corePayoutDestinationReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func corePayoutDestinationWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreHoldReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreHoldWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreRoleAssignmentReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreRoleAssignmentWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreBanVoteReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };
  public shared ({ caller }) func coreBanVoteWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };

  public shared ({ caller }) func workflowResultReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowResultWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowResultSourceReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowResultSourceWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowScheduleReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowScheduleWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowCompletionReceiptReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };
  public shared ({ caller }) func workflowCompletionReceiptWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };

  public shared ({ caller }) func treasuryObligationReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryObligationWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryPaymentOperationReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryPaymentOperationWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryJournalReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryJournalWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryChainReceiptReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };
  public shared ({ caller }) func treasuryChainReceiptWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };

  public shared ({ caller }) func migrationReceiptReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };
  public shared ({ caller }) func migrationReceiptWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };
  public shared ({ caller }) func migrationEvidenceReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };
  public shared ({ caller }) func migrationEvidenceWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };
  public shared ({ caller }) func aiArtifactReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };
  public shared ({ caller }) func aiArtifactWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };

  public shared ({ caller }) func evidenceKycReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #evidence, logicalId);
  };
  public shared ({ caller }) func evidenceKycWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #evidence, logicalId);
  };

  /// The governance-only audit is the sole administrative endpoint. It grants
  /// neither data access nor a way to alter the fixed matrix after install.
  public shared ({ caller }) func policyAudit() : async ?PolicyAudit {
    switch (Policy.authorizeGovernance(config, caller)) {
      case (#allowed) {
        ?{
          core = config.core;
          workflow = config.workflow;
          treasury = config.treasury;
          archive = config.archive;
          evidence = config.evidence;
          governance = config.governance;
        };
      };
      case (_) { null };
    };
  };
};
