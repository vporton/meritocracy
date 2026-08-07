import Principal "mo:base/Principal";

/// Disposable local-replica caller used only by the M1 storage-authority
/// boundary proof. It deliberately names the finite probe surface so that the
/// proof exercises inter-canister caller principals without adding a generic
/// method to the storage authority itself.
shared ({ caller = installer }) persistent actor class (storageAuthority : Principal) {
  assert not Principal.isAnonymous(installer);
  assert not Principal.isAnonymous(storageAuthority);

  type ProbeResult = {
    #allowed;
    #anonymousCaller;
    #callerNotAllowed;
    #invalidConfiguration;
    #malformedLogicalId;
  };

  type DataOperation = {
    #archiveRead;
    #archiveWrite;
    #coreRead;
    #coreWrite;
    #evidenceRead;
    #evidenceWrite;
    #treasuryRead;
    #treasuryWrite;
    #workflowRead;
    #workflowWrite;
  };

  type PolicyAudit = {
    archive : Principal;
    core : Principal;
    evidence : Principal;
    governance : Principal;
    treasury : Principal;
    workflow : Principal;
  };

  let storage : actor {
    archiveReadProbe : shared Text -> async ProbeResult;
    archiveWriteProbe : shared Text -> async ProbeResult;
    coreReadProbe : shared Text -> async ProbeResult;
    coreWriteProbe : shared Text -> async ProbeResult;
    evidenceReadProbe : shared Text -> async ProbeResult;
    evidenceWriteProbe : shared Text -> async ProbeResult;
    policyAudit : shared () -> async ?PolicyAudit;
    treasuryReadProbe : shared Text -> async ProbeResult;
    treasuryWriteProbe : shared Text -> async ProbeResult;
    workflowReadProbe : shared Text -> async ProbeResult;
    workflowWriteProbe : shared Text -> async ProbeResult;
  } = actor (Principal.toText(storageAuthority));

  public shared ({ caller }) func data(
    operation : DataOperation,
    logicalId : Text,
  ) : async ProbeResult {
    assert not Principal.isAnonymous(caller);
    switch (operation) {
      case (#archiveRead) { await storage.archiveReadProbe(logicalId) };
      case (#archiveWrite) { await storage.archiveWriteProbe(logicalId) };
      case (#coreRead) { await storage.coreReadProbe(logicalId) };
      case (#coreWrite) { await storage.coreWriteProbe(logicalId) };
      case (#evidenceRead) { await storage.evidenceReadProbe(logicalId) };
      case (#evidenceWrite) { await storage.evidenceWriteProbe(logicalId) };
      case (#treasuryRead) { await storage.treasuryReadProbe(logicalId) };
      case (#treasuryWrite) { await storage.treasuryWriteProbe(logicalId) };
      case (#workflowRead) { await storage.workflowReadProbe(logicalId) };
      case (#workflowWrite) { await storage.workflowWriteProbe(logicalId) };
    };
  };

  public shared ({ caller }) func audit() : async ?PolicyAudit {
    assert not Principal.isAnonymous(caller);
    await storage.policyAudit();
  };
};
