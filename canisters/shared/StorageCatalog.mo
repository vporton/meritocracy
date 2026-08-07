import Array "mo:base/Array";

/// M1 proposed in-process ZenDB catalogue. `grants` below is declarative
/// storage-authority Candid policy, never a ZenDB role/grant API. It contains
/// no principals or live permissions; the deployment-time principal matrix is
/// deliberately filled only after the M1 RBAC proof and G2 approval.
module {
  public type Owner = { #core; #workflow; #treasury; #archive; #evidence };
  public type Access = { #read; #write; #admin };
  public type Subject = { #ownerCanister; #governance };
  public type Index = {
    name : Text;
    fields : [Text];
    unique : Bool;
    purpose : Text;
  };
  public type Limits = {
    maxDocumentBytes : Nat;
    maxBatchBytes : Nat;
    maxPageSize : Nat;
    maxDocumentsPerShard : Nat;
    maxShardBytes : Nat;
  };
  public type Collection = {
    name : Text;
    owner : Owner;
    schemaVersion : Nat16;
    authoritativeCandidate : Bool;
    indexes : [Index];
    grants : [(Subject, Access)];
  };

  public let limits : Limits = {
    maxDocumentBytes = 262_144;
    maxBatchBytes = 1_048_576;
    maxPageSize = 500;
    maxDocumentsPerShard = 25_000_000;
    maxShardBytes = 53_687_091_200;
  };

  let envelopeIndexes : [Index] = [
    {
      name = "logical_id_unique";
      fields = ["logicalId"];
      unique = true;
      purpose = "idempotency and lost-reply lookup";
    },
    {
      name = "state_updated";
      fields = ["state", "updatedAtNs", "logicalId"];
      unique = false;
      purpose = "bounded repair cursor";
    },
  ];

  let ownerReadWrite : [(Subject, Access)] = [
    (#ownerCanister, #read),
    (#ownerCanister, #write),
    (#governance, #admin),
  ];

  /// Kept as a function because the per-collection index list is composed from
  /// the common envelope indexes. Module values must be static under enhanced
  /// orthogonal persistence; callers receive an immutable fresh catalogue.
  public func collections() : [Collection] {
    [
      {
        name = "core_user_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "legacy_user_unique"; fields = ["legacyId"]; unique = true; purpose = "source ID reconciliation" }, { name = "created"; fields = ["createdAtNs", "userId"]; unique = false; purpose = "user cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_principal_binding_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "principal_unique"; fields = ["principal"]; unique = true; purpose = "caller binding" }, { name = "provider_subject_unique"; fields = ["provider", "subjectHash"]; unique = true; purpose = "OAuth no-merge check" }, { name = "user"; fields = ["userId", "logicalId"]; unique = false; purpose = "user bindings" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_profile_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "user_unique"; fields = ["userId"]; unique = true; purpose = "exact profile" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_email_evidence_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "normalized_email_unique"; fields = ["normalizedEmail"]; unique = true; purpose = "non-null email uniqueness" }, { name = "user_verified"; fields = ["userId", "verified", "logicalId"]; unique = false; purpose = "user email cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_payout_destination_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "address_unique"; fields = ["chain", "network", "canonicalAddress"]; unique = true; purpose = "destination ownership" }, { name = "user_effective"; fields = ["userId", "effectiveAfterNs", "logicalId"]; unique = false; purpose = "destination history" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_hold_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "user_kind"; fields = ["userId", "kind", "startsAtNs", "logicalId"]; unique = false; purpose = "eligibility" }, { name = "due"; fields = ["endsAtNs", "logicalId"]; unique = false; purpose = "bounded expiry cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_role_assignment_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "principal_role_unique"; fields = ["principal", "role"]; unique = true; purpose = "exact capability" }, { name = "role_principal"; fields = ["role", "principal"]; unique = false; purpose = "role audit" }]);
        grants = ownerReadWrite;
      },
      {
        name = "core_ban_vote_v1";
        owner = #core;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "vote_epoch_unique"; fields = ["voterUserId", "targetUserId", "epoch"]; unique = true; purpose = "one vote per epoch" }, { name = "target_epoch"; fields = ["targetUserId", "epoch", "logicalId"]; unique = false; purpose = "tally cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "workflow_result_v1";
        owner = #workflow;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "cycle_unique"; fields = ["userId", "cycleId", "resultKind"]; unique = true; purpose = "final result idempotency" }, { name = "user_completed"; fields = ["userId", "completedAtNs", "logicalId"]; unique = false; purpose = "user history" }]);
        grants = ownerReadWrite;
      },
      {
        name = "workflow_result_source_v1";
        owner = #workflow;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "result_ordinal_unique"; fields = ["resultLogicalId", "ordinal"]; unique = true; purpose = "ordered sources" }, { name = "result_url_unique"; fields = ["resultLogicalId", "urlHash"]; unique = true; purpose = "source deduplication" }]);
        grants = ownerReadWrite;
      },
      {
        name = "workflow_schedule_v1";
        owner = #workflow;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "schedule_unique"; fields = ["scheduleName"]; unique = true; purpose = "durable schedule" }, { name = "due"; fields = ["dueAtNs", "logicalId"]; unique = false; purpose = "timer cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "workflow_completion_receipt_v1";
        owner = #workflow;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "completion_unique"; fields = ["cycleId", "operationName"]; unique = true; purpose = "at-least-once completion" }]);
        grants = ownerReadWrite;
      },
      {
        name = "treasury_obligation_v1";
        owner = #treasury;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "obligation_unique"; fields = ["cycleId", "userId", "scope", "assetId"]; unique = true; purpose = "liability uniqueness" }, { name = "asset_status"; fields = ["assetId", "status", "logicalId"]; unique = false; purpose = "reconciliation cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "treasury_payment_operation_v1";
        owner = #treasury;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "operation_unique"; fields = ["operationId"]; unique = true; purpose = "at-most-one transfer" }, { name = "obligation"; fields = ["obligationId", "logicalId"]; unique = false; purpose = "operation lookup" }, { name = "asset_status"; fields = ["assetId", "status", "logicalId"]; unique = false; purpose = "reconciliation cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "treasury_journal_v1";
        owner = #treasury;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "entry_unique"; fields = ["journalSequence"]; unique = true; purpose = "append order" }, { name = "account_asset_sequence"; fields = ["accountId", "assetId", "journalSequence"]; unique = false; purpose = "balance reconciliation" }, { name = "operation"; fields = ["operationId", "journalSequence"]; unique = false; purpose = "payment audit" }]);
        grants = ownerReadWrite;
      },
      {
        name = "treasury_chain_receipt_v1";
        owner = #treasury;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "chain_tx_unique"; fields = ["chain", "network", "transactionId"]; unique = true; purpose = "external deduplication" }, { name = "operation_attempt_unique"; fields = ["operationId", "attemptId"]; unique = true; purpose = "attempt reconciliation" }]);
        grants = ownerReadWrite;
      },
      {
        name = "migration_receipt_v1";
        owner = #archive;
        schemaVersion = 1;
        authoritativeCandidate = true;
        indexes = Array.append(envelopeIndexes, [{ name = "chunk_unique"; fields = ["migrationId", "sourceTable", "chunk"]; unique = true; purpose = "idempotent import" }, { name = "table_chunk"; fields = ["migrationId", "sourceTable", "chunk"]; unique = false; purpose = "resume cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "migration_evidence_v1";
        owner = #archive;
        schemaVersion = 1;
        authoritativeCandidate = false;
        indexes = Array.append(envelopeIndexes, [{ name = "source_row_unique"; fields = ["sourceTable", "sourceRowId"]; unique = true; purpose = "exception evidence" }]);
        grants = ownerReadWrite;
      },
      {
        name = "ai_artifact_v1";
        owner = #archive;
        schemaVersion = 1;
        authoritativeCandidate = false;
        indexes = Array.append(envelopeIndexes, [{ name = "payload_hash_unique"; fields = ["payloadHash"]; unique = true; purpose = "content-addressed payload" }, { name = "retention"; fields = ["retentionClass", "createdAtNs", "logicalId"]; unique = false; purpose = "bounded retention cursor" }]);
        grants = ownerReadWrite;
      },
      {
        name = "evidence_kyc_v1";
        owner = #evidence;
        schemaVersion = 1;
        authoritativeCandidate = false;
        indexes = Array.append(envelopeIndexes, [{ name = "attestation_unique"; fields = ["attestationId"]; unique = true; purpose = "provider event deduplication" }, { name = "erasure_due"; fields = ["erasureDueAtNs", "logicalId"]; unique = false; purpose = "restricted retention cursor" }]);
        grants = ownerReadWrite;
      },
    ];
  };
};
