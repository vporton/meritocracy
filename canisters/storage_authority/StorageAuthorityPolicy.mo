import Principal "mo:base/Principal";
import Text "mo:base/Text";
import StorageCatalog "../shared/StorageCatalog";

/// The storage authority's authorization decision is deliberately independent
/// of ZenDB.  ZenDB is an in-process persistence library, not a principal or
/// role authority.  Keeping this module pure makes the caller/owner/action
/// matrix executable before any collection is made authoritative.
module {
  public type Config = {
    core : Principal;
    workflow : Principal;
    treasury : Principal;
    archive : Principal;
    evidence : Principal;
    governance : Principal;
  };

  public type Decision = {
    #allowed;
    #anonymousCaller;
    #invalidConfiguration;
    #callerNotAllowed;
    #malformedLogicalId;
  };

  public let maxLogicalIdChars : Nat = 512;

  func isAnonymous(principal : Principal) : Bool {
    Principal.isAnonymous(principal);
  };

  /// The configured application and governance principals must be separate.
  /// In particular, a deployer/controller is not implicitly an application or
  /// governance principal merely because it created the canister.
  public func isValidConfig(config : Config) : Bool {
    let principals = [
      config.core,
      config.workflow,
      config.treasury,
      config.archive,
      config.evidence,
      config.governance,
    ];

    for (principal in principals.vals()) {
      if (isAnonymous(principal)) {
        return false;
      };
    };

    var left : Nat = 0;
    while (left < principals.size()) {
      var right = left + 1;
      while (right < principals.size()) {
        if (principals[left] == principals[right]) {
          return false;
        };
        right += 1;
      };
      left += 1;
    };
    true;
  };

  /// Installation must not silently turn the bootstrap/deployer principal into
  /// an application or governance authority. The production deployment
  /// ceremony supplies a separately approved installer; this M1 scaffold only
  /// verifies the rejection rule and never deploys it.
  public func canInstall(config : Config, installer : Principal) : Bool {
    if (isAnonymous(installer) or not isValidConfig(config)) {
      return false;
    };
    installer != config.core and installer != config.workflow and installer != config.treasury and installer != config.archive and installer != config.evidence and installer != config.governance;
  };

  public func ownerPrincipal(
    config : Config,
    owner : StorageCatalog.Owner,
  ) : Principal {
    switch (owner) {
      case (#core) { config.core };
      case (#workflow) { config.workflow };
      case (#treasury) { config.treasury };
      case (#archive) { config.archive };
      case (#evidence) { config.evidence };
    };
  };

  /// This rejects control characters and unbounded IDs before the storage
  /// engine is reached. The trusted domain actor derives the immutable logical
  /// ID; the Candid surface selects its owner internally and never accepts an
  /// owner, role, collection name, or ZenDB document ID from a caller.
  public func isValidLogicalId(logicalId : Text) : Bool {
    if (logicalId.size() == 0 or logicalId.size() > maxLogicalIdChars) {
      return false;
    };
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') {
        return false;
      };
    };
    true;
  };

  /// Reads and writes are scoped to the single owner selected by the method
  /// implementation. Governance has administration/audit access only; it is
  /// not a data reader or writer. There is no application-admin role.
  public func authorizeData(
    config : Config,
    caller : Principal,
    owner : StorageCatalog.Owner,
    logicalId : Text,
  ) : Decision {
    if (isAnonymous(caller)) {
      return #anonymousCaller;
    };
    if (not isValidConfig(config)) {
      return #invalidConfiguration;
    };
    if (caller != ownerPrincipal(config, owner)) {
      return #callerNotAllowed;
    };
    if (not isValidLogicalId(logicalId)) {
      return #malformedLogicalId;
    };
    #allowed;
  };

  public func authorizeGovernance(
    config : Config,
    caller : Principal,
  ) : Decision {
    if (isAnonymous(caller)) {
      return #anonymousCaller;
    };
    if (not isValidConfig(config)) {
      return #invalidConfiguration;
    };
    if (caller != config.governance) {
      return #callerNotAllowed;
    };
    #allowed;
  };
};
