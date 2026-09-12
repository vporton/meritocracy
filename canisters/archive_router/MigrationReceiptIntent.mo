import Blob "mo:base/Blob";
import MutationRecovery "../shared/MutationRecovery";
import StorageTypes "../shared/StorageTypes";

/// M1's fixed migration-receipt recovery contract.
///
/// This is deliberately a pure, metadata-only contract. It does not decode a
/// canonical chunk, read PostgreSQL, accept source credentials, or call the
/// storage authority. A future authenticated importer must retain this exact
/// receipt intent before its fixed `migration_receipt_v1` write, and reconcile
/// an unknown reply only by the retained logical-ID/version/content-hash
/// tuple. In particular, a changed chunk hash can never be treated as a retry.
module {
  public type Input = {
    logicalId : Text;
    migrationId : Text;
    sourceTable : Text;
    chunk : Nat64;
    rowCount : Nat32;
    payloadHash : Blob;
    desiredVersion : Nat64;
    contentHash : Blob;
  };

  public type Intent = {
    input : Input;
    phase : StorageTypes.MutationPhase;
  };

  let maxLogicalIdBytes = 512;
  let maxMigrationIdBytes = 256;
  let maxSourceTableBytes = 128;
  let maxRowsPerChunk : Nat32 = 500;

  func boundedText(value : Text, maximum : Nat) : Bool {
    if (value.size() == 0 or value.size() > maximum) return false;
    for (character in value.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return false;
    };
    true;
  };

  func hash(value : Blob) : Bool { Blob.toArray(value).size() == 32 };

  /// A receipt cannot represent an empty or unbounded import chunk. The
  /// source table is only bounded metadata here; the G2-approved canonical
  /// importer must separately bind it to its fixed source projection.
  public func valid(input : Input) : Bool {
    boundedText(input.logicalId, maxLogicalIdBytes) and
    boundedText(input.migrationId, maxMigrationIdBytes) and
    boundedText(input.sourceTable, maxSourceTableBytes) and
    input.rowCount > 0 and input.rowCount <= maxRowsPerChunk and
    hash(input.payloadHash) and hash(input.contentHash);
  };

  public func prepare(input : Input) : ?Intent {
    if (not valid(input)) return null;
    ?{ input; phase = #prepared };
  };

  public func startRemoteWrite(intent : Intent) : Intent {
    { intent with phase = #remoteWriteStarted };
  };

  public func lostReply(intent : Intent) : Intent {
    { intent with phase = #reconciling };
  };

  /// Absence permits only an identical redelivery from the caller's durable
  /// intent. A present record must have both the same immutable version and
  /// content hash; neither a replacement receipt nor a conflicting chunk can
  /// be acknowledged by this rule.
  public func reconcile(
    intent : Intent,
    observed : MutationRecovery.RemoteObservation,
  ) : (Intent, MutationRecovery.RecoveryDecision) {
    let decision = MutationRecovery.resolve(
      intent.input.desiredVersion,
      intent.input.contentHash,
      { version = null; contentHash = null },
      observed,
    );
    ({ intent with phase = MutationRecovery.phaseAfterRecovery(decision) }, decision);
  };
};
