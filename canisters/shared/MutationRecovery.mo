import Blob "mo:base/Blob";
import StorageTypes "StorageTypes";

/// Pure M1 recovery rules for an owning canister after a storage-authority
/// reply is lost or a duplicate delivery arrives. This module makes no
/// persistence or cross-canister call: it fixes the decision that a future
/// durable actor must apply to its journaled intent and bounded lookup.
module {
  public let hashBytes : Nat = 32;
  public let maxManifestMembers : Nat = 500;

  public type RemoteObservation = {
    #absent;
    #present : {
      version : Nat64;
      contentHash : StorageTypes.Hash;
    };
  };

  public type RecoveryDecision = {
    #acknowledge;
    #retryIdentical;
    #conflict;
    #blocked;
  };

  public type ManifestDecision = { #activate; #remainPending; #blocked };

  func validHash(hash : StorageTypes.Hash) : Bool {
    Blob.toArray(hash).size() == hashBytes;
  };

  func matchesExpected(
    expected : StorageTypes.ExpectedRemote,
    observed : RemoteObservation,
  ) : Bool {
    switch (observed, expected.version, expected.contentHash) {
      case (#absent, null, null) { true };
      case (#present(remote), ?version, ?contentHash) {
        remote.version == version and remote.contentHash == contentHash
      };
      case (_) { false };
    };
  };

  /// The desired logical ID and canonical bytes are already fixed in the
  /// durable operation state. This function permits retry only when the
  /// lookup proves the old CAS target is still intact. It never treats a
  /// partial expected value, a malformed hash, or a concurrent version/hash
  /// as safe to retry.
  public func resolve(
    desiredVersion : Nat64,
    desiredContentHash : StorageTypes.Hash,
    expected : StorageTypes.ExpectedRemote,
    observed : RemoteObservation,
  ) : RecoveryDecision {
    if (not validHash(desiredContentHash)) {
      return #blocked;
    };

    switch (observed) {
      case (#present(remote)) {
        if (not validHash(remote.contentHash)) {
          return #blocked;
        };
        if (remote.version == desiredVersion and remote.contentHash == desiredContentHash) {
          return #acknowledge;
        };
      };
      case (#absent) {};
    };

    if (matchesExpected(expected, observed)) {
      #retryIdentical;
    } else {
      #conflict;
    };
  };

  /// A recovered intent can only become acknowledged after an exact
  /// logical-ID/version/hash match. A retry remains at the journaled remote
  /// boundary; it must reuse the same operation, attempt material, logical
  /// ID, and canonical bytes.
  public func phaseAfterRecovery(decision : RecoveryDecision) : StorageTypes.MutationPhase {
    switch (decision) {
      case (#acknowledge) { #acknowledged };
      case (#retryIdentical) { #remoteWriteStarted };
      case (#conflict) { #conflict };
      case (#blocked) { #blocked };
    };
  };

  /// A visibility pointer may activate only after every bounded member intent
  /// and the pointer itself are acknowledged. A failed/unknown archive or
  /// member acknowledgement therefore remains non-authoritative.
  public func decideManifestActivation(
    memberPhases : [StorageTypes.MutationPhase],
    manifestAcknowledged : Bool,
  ) : ManifestDecision {
    if (memberPhases.size() == 0 or memberPhases.size() > maxManifestMembers) {
      return #blocked;
    };
    if (not manifestAcknowledged) {
      return #remainPending;
    };
    for (phase in memberPhases.vals()) {
      if (phase != #acknowledged) {
        return #remainPending;
      };
    };
    #activate;
  };
};
