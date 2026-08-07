import Principal "mo:base/Principal";
import StorageCatalog "../shared/StorageCatalog";
import Policy "StorageAuthorityPolicy";

/// M1 storage-authority boundary scaffold.
///
/// This canister deliberately has no ZenDB import, collection, payload, or
/// grant-management API yet. Its only surface is a bounded authorization probe
/// used to prove that ingress is rejected and that each future storage method
/// will select its collection owner in Motoko rather than accepting a generic
/// collection/action/role request from Candid. No probe persists or exposes
/// target data, and this canister is not deployed or authoritative.
shared ({ caller = installer }) persistent actor class (initialConfig : Policy.Config) {
  // This is deliberately a persistent private field, rather than an actor
  // constructor parameter captured by method closures. Upgrade calls still
  // carry an init argument for the actor class, but that argument must never
  // replace the installed caller matrix. There is no mutation endpoint.
  var config : Policy.Config = initialConfig;

  assert Policy.canInstall(config, installer);

  type ProbeResult = Policy.Decision;

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

  // These collection-specific methods are intentionally not a generic
  // `(collection, action, document)` interface. A future in-process ZenDB
  // call can be added only behind the matching, fixed collection/action
  // method. The caller cannot choose a collection or action from Candid.
  public shared ({ caller }) func coreUserReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreUserWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func corePrincipalBindingReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func corePrincipalBindingWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreProfileReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreProfileWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreEmailEvidenceReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreEmailEvidenceWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func corePayoutDestinationReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func corePayoutDestinationWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreHoldReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreHoldWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreRoleAssignmentReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreRoleAssignmentWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreBanVoteReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };
  public shared ({ caller }) func coreBanVoteWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #core, logicalId) };

  public shared ({ caller }) func workflowResultReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowResultWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowResultSourceReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowResultSourceWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowScheduleReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowScheduleWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowCompletionReceiptReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };
  public shared ({ caller }) func workflowCompletionReceiptWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #workflow, logicalId) };

  public shared ({ caller }) func treasuryObligationReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryObligationWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryPaymentOperationReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryPaymentOperationWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryJournalReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryJournalWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryChainReceiptReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };
  public shared ({ caller }) func treasuryChainReceiptWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #treasury, logicalId) };

  public shared ({ caller }) func migrationReceiptReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };
  public shared ({ caller }) func migrationReceiptWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };
  public shared ({ caller }) func migrationEvidenceReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };
  public shared ({ caller }) func migrationEvidenceWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };
  public shared ({ caller }) func aiArtifactReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };
  public shared ({ caller }) func aiArtifactWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #archive, logicalId) };

  public shared ({ caller }) func evidenceKycReadProbe(logicalId : Text) : async ProbeResult { probe(caller, #evidence, logicalId) };
  public shared ({ caller }) func evidenceKycWriteProbe(logicalId : Text) : async ProbeResult { probe(caller, #evidence, logicalId) };

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
