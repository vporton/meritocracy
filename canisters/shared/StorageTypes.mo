import Principal "mo:base/Principal";

/// M1 storage-contract types. These are data definitions only: the core
/// scaffold imports them solely for compile-time checking, and no record grants
/// authority by itself.
module {
  public type Hash = Blob; // SHA-256, exactly 32 bytes when encoded.
  public type LogicalId = Text;
  public type SchemaVersion = Nat16;
  public type TimestampNs = Int;

  public type DocumentState = { #pending; #active; #tombstoned };

  /// Present on every ZenDB document. `logicalId`, not a ZenDB-generated ID, is
  /// the application identity and is uniquely indexed in its collection.
  public type Envelope = {
    logicalId : LogicalId;
    schemaVersion : SchemaVersion;
    contentHash : Hash;
    state : DocumentState;
    createdAtNs : TimestampNs;
    updatedAtNs : TimestampNs;
    observedZenDbId : ?Text;
  };

  public type PrincipalBindingV1 = {
    envelope : Envelope;
    userId : Nat64;
    principal : Principal;
    factor : { #internetIdentity; #oauth };
    provider : ?Text;
    subjectHash : ?Hash;
    verifiedAtNs : TimestampNs;
    revokedAtNs : ?TimestampNs;
  };

  public type UserV1 = {
    envelope : Envelope;
    userId : Nat64;
    legacyId : ?Nat64;
    createdAtNs : TimestampNs;
    deletedAtNs : ?TimestampNs;
    profileVersion : Nat64;
  };

  public type PayoutDestinationV1 = {
    envelope : Envelope;
    userId : Nat64;
    chain : Text;
    network : Text;
    canonicalAddress : Blob;
    displayAddress : Text;
    proofState : { #unverified; #pending; #verified; #revoked };
    effectiveAfterNs : TimestampNs;
    supersedesLogicalId : ?LogicalId;
  };

  public type HoldV1 = {
    envelope : Envelope;
    userId : Nat64;
    kind : { #ban; #payment; #evaluation; #kyc; #liveliness };
    startsAtNs : TimestampNs;
    endsAtNs : ?TimestampNs;
    policyVersion : Nat64;
  };

  public type RoleAssignmentV1 = {
    envelope : Envelope;
    principal : Principal;
    role : Text;
    grantedBy : Principal;
    grantedAtNs : TimestampNs;
    revokedAtNs : ?TimestampNs;
  };

  public type ResultV1 = {
    envelope : Envelope;
    userId : Nat64;
    cycleId : Text;
    evaluatorVersion : Nat16;
    resultKind : Text;
    completedAtNs : TimestampNs;
    sourceSetHash : Hash;
  };

  public type AssetId = {
    chain : Text;
    network : Text;
    standard : Text;
    locator : Text;
    decimals : Nat8;
  };

  public type PaymentOperationV1 = {
    envelope : Envelope;
    operationId : LogicalId;
    obligationId : LogicalId;
    asset : AssetId;
    amountBaseUnits : Nat;
    destinationSnapshotHash : Hash;
    policyVersion : Nat64;
    status : { #prepared; #submitted; #ambiguous; #confirmed; #failed; #paused };
  };

  public type MigrationReceiptV1 = {
    envelope : Envelope;
    migrationId : Text;
    sourceTable : Text;
    chunk : Nat64;
    payloadHash : Hash;
    rowCount : Nat32;
    acknowledgedAtNs : ?TimestampNs;
  };

  /// This stays in the owning persistent Motoko actor before every remote call.
  /// `expected` makes an update a compare-and-reconcile operation rather than a
  /// blind overwrite. It is intentionally separate from the remote document.
  public type ExpectedRemote = {
    version : ?Nat64;
    contentHash : ?Hash;
  };

  public type MutationPhase = {
    #prepared;
    #remoteWriteStarted;
    #reconciling;
    #acknowledged;
    #conflict;
    #blocked;
  };

  public type MutationIntentV1 = {
    intentId : LogicalId;
    operationId : LogicalId;
    attemptId : Nat64;
    collection : Text;
    logicalId : LogicalId;
    desiredContentHash : Hash;
    expected : ExpectedRemote;
    phase : MutationPhase;
    createdAtNs : TimestampNs;
    lastTransitionAtNs : TimestampNs;
    observedZenDbId : ?Text;
    reconciliationHash : ?Hash;
  };

  /// A multi-document change remains invisible until every member intent is
  /// acknowledged and this separately journaled pointer is acknowledged.
  public type VisibilityManifestV1 = {
    envelope : Envelope;
    operationId : LogicalId;
    memberIntentIds : [LogicalId];
    expectedMemberRoot : Hash;
    activatedAtNs : ?TimestampNs;
  };

  public type CollectionMigrationV1 = {
    migrationId : LogicalId;
    sourceCollection : Text;
    targetCollection : Text;
    sourceSchemaVersion : SchemaVersion;
    targetSchemaVersion : SchemaVersion;
    cursor : ?Blob;
    copiedCount : Nat64;
    copiedHash : Hash;
    phase : { #copying; #verifying; #readyToSwitch; #switched; #rollbackOnly };
  };
};
