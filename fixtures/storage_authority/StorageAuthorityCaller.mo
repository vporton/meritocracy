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
    #coreUserRead; #coreUserWrite; #corePrincipalBindingRead; #corePrincipalBindingWrite;
    #coreProfileRead; #coreProfileWrite; #coreEmailEvidenceRead; #coreEmailEvidenceWrite;
    #corePayoutDestinationRead; #corePayoutDestinationWrite; #coreHoldRead; #coreHoldWrite;
    #coreRoleAssignmentRead; #coreRoleAssignmentWrite; #coreBanVoteRead; #coreBanVoteWrite;
    #workflowResultRead; #workflowResultWrite; #workflowResultSourceRead; #workflowResultSourceWrite;
    #workflowScheduleRead; #workflowScheduleWrite; #workflowCompletionReceiptRead; #workflowCompletionReceiptWrite;
    #treasuryObligationRead; #treasuryObligationWrite; #treasuryPaymentOperationRead; #treasuryPaymentOperationWrite;
    #treasuryJournalRead; #treasuryJournalWrite; #treasuryChainReceiptRead; #treasuryChainReceiptWrite;
    #migrationReceiptRead; #migrationReceiptWrite; #migrationEvidenceRead; #migrationEvidenceWrite;
    #aiArtifactRead; #aiArtifactWrite; #evidenceKycRead; #evidenceKycWrite;
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
    coreUserReadProbe : shared Text -> async ProbeResult; coreUserWriteProbe : shared Text -> async ProbeResult;
    corePrincipalBindingReadProbe : shared Text -> async ProbeResult; corePrincipalBindingWriteProbe : shared Text -> async ProbeResult;
    coreProfileReadProbe : shared Text -> async ProbeResult; coreProfileWriteProbe : shared Text -> async ProbeResult;
    coreEmailEvidenceReadProbe : shared Text -> async ProbeResult; coreEmailEvidenceWriteProbe : shared Text -> async ProbeResult;
    corePayoutDestinationReadProbe : shared Text -> async ProbeResult; corePayoutDestinationWriteProbe : shared Text -> async ProbeResult;
    coreHoldReadProbe : shared Text -> async ProbeResult; coreHoldWriteProbe : shared Text -> async ProbeResult;
    coreRoleAssignmentReadProbe : shared Text -> async ProbeResult; coreRoleAssignmentWriteProbe : shared Text -> async ProbeResult;
    coreBanVoteReadProbe : shared Text -> async ProbeResult; coreBanVoteWriteProbe : shared Text -> async ProbeResult;
    workflowResultReadProbe : shared Text -> async ProbeResult; workflowResultWriteProbe : shared Text -> async ProbeResult;
    workflowResultSourceReadProbe : shared Text -> async ProbeResult; workflowResultSourceWriteProbe : shared Text -> async ProbeResult;
    workflowScheduleReadProbe : shared Text -> async ProbeResult; workflowScheduleWriteProbe : shared Text -> async ProbeResult;
    workflowCompletionReceiptReadProbe : shared Text -> async ProbeResult; workflowCompletionReceiptWriteProbe : shared Text -> async ProbeResult;
    treasuryObligationReadProbe : shared Text -> async ProbeResult; treasuryObligationWriteProbe : shared Text -> async ProbeResult;
    treasuryPaymentOperationReadProbe : shared Text -> async ProbeResult; treasuryPaymentOperationWriteProbe : shared Text -> async ProbeResult;
    treasuryJournalReadProbe : shared Text -> async ProbeResult; treasuryJournalWriteProbe : shared Text -> async ProbeResult;
    treasuryChainReceiptReadProbe : shared Text -> async ProbeResult; treasuryChainReceiptWriteProbe : shared Text -> async ProbeResult;
    migrationReceiptReadProbe : shared Text -> async ProbeResult; migrationReceiptWriteProbe : shared Text -> async ProbeResult;
    migrationEvidenceReadProbe : shared Text -> async ProbeResult; migrationEvidenceWriteProbe : shared Text -> async ProbeResult;
    aiArtifactReadProbe : shared Text -> async ProbeResult; aiArtifactWriteProbe : shared Text -> async ProbeResult;
    evidenceKycReadProbe : shared Text -> async ProbeResult; evidenceKycWriteProbe : shared Text -> async ProbeResult;
    policyAudit : shared () -> async ?PolicyAudit;
  } = actor (Principal.toText(storageAuthority));

  public shared ({ caller }) func data(
    operation : DataOperation,
    logicalId : Text,
  ) : async ProbeResult {
    assert not Principal.isAnonymous(caller);
    switch (operation) {
      case (#coreUserRead) { await storage.coreUserReadProbe(logicalId) }; case (#coreUserWrite) { await storage.coreUserWriteProbe(logicalId) };
      case (#corePrincipalBindingRead) { await storage.corePrincipalBindingReadProbe(logicalId) }; case (#corePrincipalBindingWrite) { await storage.corePrincipalBindingWriteProbe(logicalId) };
      case (#coreProfileRead) { await storage.coreProfileReadProbe(logicalId) }; case (#coreProfileWrite) { await storage.coreProfileWriteProbe(logicalId) };
      case (#coreEmailEvidenceRead) { await storage.coreEmailEvidenceReadProbe(logicalId) }; case (#coreEmailEvidenceWrite) { await storage.coreEmailEvidenceWriteProbe(logicalId) };
      case (#corePayoutDestinationRead) { await storage.corePayoutDestinationReadProbe(logicalId) }; case (#corePayoutDestinationWrite) { await storage.corePayoutDestinationWriteProbe(logicalId) };
      case (#coreHoldRead) { await storage.coreHoldReadProbe(logicalId) }; case (#coreHoldWrite) { await storage.coreHoldWriteProbe(logicalId) };
      case (#coreRoleAssignmentRead) { await storage.coreRoleAssignmentReadProbe(logicalId) }; case (#coreRoleAssignmentWrite) { await storage.coreRoleAssignmentWriteProbe(logicalId) };
      case (#coreBanVoteRead) { await storage.coreBanVoteReadProbe(logicalId) }; case (#coreBanVoteWrite) { await storage.coreBanVoteWriteProbe(logicalId) };
      case (#workflowResultRead) { await storage.workflowResultReadProbe(logicalId) }; case (#workflowResultWrite) { await storage.workflowResultWriteProbe(logicalId) };
      case (#workflowResultSourceRead) { await storage.workflowResultSourceReadProbe(logicalId) }; case (#workflowResultSourceWrite) { await storage.workflowResultSourceWriteProbe(logicalId) };
      case (#workflowScheduleRead) { await storage.workflowScheduleReadProbe(logicalId) }; case (#workflowScheduleWrite) { await storage.workflowScheduleWriteProbe(logicalId) };
      case (#workflowCompletionReceiptRead) { await storage.workflowCompletionReceiptReadProbe(logicalId) }; case (#workflowCompletionReceiptWrite) { await storage.workflowCompletionReceiptWriteProbe(logicalId) };
      case (#treasuryObligationRead) { await storage.treasuryObligationReadProbe(logicalId) }; case (#treasuryObligationWrite) { await storage.treasuryObligationWriteProbe(logicalId) };
      case (#treasuryPaymentOperationRead) { await storage.treasuryPaymentOperationReadProbe(logicalId) }; case (#treasuryPaymentOperationWrite) { await storage.treasuryPaymentOperationWriteProbe(logicalId) };
      case (#treasuryJournalRead) { await storage.treasuryJournalReadProbe(logicalId) }; case (#treasuryJournalWrite) { await storage.treasuryJournalWriteProbe(logicalId) };
      case (#treasuryChainReceiptRead) { await storage.treasuryChainReceiptReadProbe(logicalId) }; case (#treasuryChainReceiptWrite) { await storage.treasuryChainReceiptWriteProbe(logicalId) };
      case (#migrationReceiptRead) { await storage.migrationReceiptReadProbe(logicalId) }; case (#migrationReceiptWrite) { await storage.migrationReceiptWriteProbe(logicalId) };
      case (#migrationEvidenceRead) { await storage.migrationEvidenceReadProbe(logicalId) }; case (#migrationEvidenceWrite) { await storage.migrationEvidenceWriteProbe(logicalId) };
      case (#aiArtifactRead) { await storage.aiArtifactReadProbe(logicalId) }; case (#aiArtifactWrite) { await storage.aiArtifactWriteProbe(logicalId) };
      case (#evidenceKycRead) { await storage.evidenceKycReadProbe(logicalId) }; case (#evidenceKycWrite) { await storage.evidenceKycWriteProbe(logicalId) };
    };
  };

  public shared ({ caller }) func audit() : async ?PolicyAudit {
    assert not Principal.isAnonymous(caller);
    await storage.policyAudit();
  };
};
