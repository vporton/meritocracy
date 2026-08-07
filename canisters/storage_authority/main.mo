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

  // These owner-specific methods are intentionally not a generic
  // `(collection, action, document)` interface. A future in-process ZenDB
  // call can be added only behind the matching, fixed owner method.
  public shared ({ caller }) func coreReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };

  public shared ({ caller }) func coreWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #core, logicalId);
  };

  public shared ({ caller }) func workflowReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };

  public shared ({ caller }) func workflowWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #workflow, logicalId);
  };

  public shared ({ caller }) func treasuryReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };

  public shared ({ caller }) func treasuryWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #treasury, logicalId);
  };

  public shared ({ caller }) func archiveReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };

  public shared ({ caller }) func archiveWriteProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #archive, logicalId);
  };

  public shared ({ caller }) func evidenceReadProbe(logicalId : Text) : async ProbeResult {
    probe(caller, #evidence, logicalId);
  };

  public shared ({ caller }) func evidenceWriteProbe(logicalId : Text) : async ProbeResult {
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
