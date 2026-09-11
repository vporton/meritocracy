import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

/// M1 identity/role mutation preconditions.  This remains deliberately pure:
/// the storage authority must apply the decision only after its fixed core
/// caller check and must journal the immutable desired version/hash before a
/// persistence attempt.  Keeping identity and role rules here prevents a
/// future collection method from treating a caller-selected principal, role,
/// or partial hash as authority.
module {
  public let maxRoleChars : Nat = 128;

  public type Decision = {
    #accept;
    #blocked;
    #conflict;
  };

  public type PrincipalBindingInput = {
    logicalId : Text;
    /// Immutable remote record version. Recovery acknowledges an unknown
    /// reply only when this and `contentHash` both match the lookup.
    desiredVersion : Nat64;
    contentHash : Blob;
    userId : Nat64;
    principal : Principal;
    factor : { #internetIdentity; #oauth };
    provider : ?Text;
    subjectHash : ?Blob;
  };

  public type RoleAssignmentInput = {
    logicalId : Text;
    /// Immutable remote record version; role transitions get a new logical
    /// record rather than overwriting a prior assignment.
    desiredVersion : Nat64;
    contentHash : Blob;
    principal : Principal;
    role : Text;
  };

  func isHash(hash : Blob) : Bool { Blob.toArray(hash).size() == 32 };

  func isBoundedText(value : Text, maximum : Nat) : Bool {
    if (value.size() == 0 or value.size() > maximum) { return false };
    for (character in value.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') { return false };
    };
    true;
  };

  public func validPrincipalBinding(input : PrincipalBindingInput) : Bool {
    if (
      not isBoundedText(input.logicalId, 512) or
      not isHash(input.contentHash) or
      Principal.isAnonymous(input.principal)
    ) { return false };
    switch (input.factor, input.provider, input.subjectHash) {
      case (#internetIdentity, null, null) { true };
      case (#oauth, ?provider, ?subjectHash) {
        isBoundedText(provider, 128) and isHash(subjectHash);
      };
      case (_) { false };
    };
  };

  /// Roles are immutable assignment labels. Revocation is a later versioned
  /// record transition; callers cannot encode a role change as a replacement
  /// for an existing logical assignment ID.
  public func validRoleAssignment(input : RoleAssignmentInput) : Bool {
    isBoundedText(input.logicalId, 512) and
    isHash(input.contentHash) and
    not Principal.isAnonymous(input.principal) and
    isBoundedText(input.role, maxRoleChars);
  };

  /// A duplicate delivery is harmless only if it has the exact immutable
  /// version and content hash. A lookup under the same logical ID with either
  /// value changed fails closed; callers must create neither a new assignment
  /// ID nor a replacement role record.
  public func decideIdempotentWrite(
    valid : Bool,
    desiredVersion : Nat64,
    desiredHash : Blob,
    observed : ?{ version : Nat64; contentHash : Blob },
  ) : Decision {
    if (not valid or not isHash(desiredHash)) { return #blocked };
    switch (observed) {
      case (null) { #accept };
      case (?record) {
        if (
          record.version == desiredVersion and
          isHash(record.contentHash) and
          record.contentHash == desiredHash
        ) { #accept } else { #conflict };
      };
    };
  };
}
