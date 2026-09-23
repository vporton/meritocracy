import Blob "mo:base/Blob";
import ZenDB "mo:zendb";
import IdentityRole "../shared/IdentityRoleRecovery";
import StorageCatalog "../shared/StorageCatalog";

/// A deliberately narrow application-private embedded-store adapter. It
/// models the two fixed core collections that carry identity and role records.
/// It has no Candid surface, grant API, or caller authorization: the owning
/// application actor must enforce those before using this private module.
///
/// The adapter is intentionally insert-only.  A logical ID is immutable; a
/// second delivery is acknowledged only after an exact hash lookup, while a
/// different hash is a conflict.  Role revocation must therefore be a new,
/// versioned record transition rather than an overwrite.
module {
  public type WriteResult = { #acknowledged; #blocked; #conflict; #storageError };
  /// A fixed, bounded recovery observation.  It intentionally reveals no
  /// principal, OAuth evidence, or document identifier: the owning core actor
  /// needs only the immutable tuple it journaled before its write attempt.
  public type BindingObservation = {
    #absent;
    #present : { version : Nat64; contentHash : Blob };
    #conflict;
    #storageError;
  };
  /// The role recovery observation deliberately has the same tiny tuple as a
  /// binding observation.  It does not disclose the assigned principal or
  /// role label: the core can reconcile only the immutable tuple it journaled
  /// before its fixed role-assignment write.
  public type RoleObservation = {
    #absent;
    #present : { version : Nat64; contentHash : Blob };
    #conflict;
    #storageError;
  };

  /// Full immutable binding tuple used for duplicate reconciliation.  A
  /// matching logical ID/version/hash alone is insufficient: it could conceal
  /// a substituted identity factor or OAuth subject.
  public type ImmutableBindingObservation = {
    version : Nat64;
    contentHash : Blob;
    userId : Nat64;
    principal : Principal;
    factor : { #internetIdentity; #oauth };
    provider : ?Text;
    subjectHash : ?Blob;
  };

  /// Full immutable role tuple used for duplicate reconciliation.  The role
  /// label and subject principal are part of the assignment, not metadata a
  /// retry may replace under a coincident version/hash.
  public type ImmutableRoleObservation = {
    version : Nat64;
    contentHash : Blob;
    principal : Principal;
    role : Text;
  };

  type BindingRecord = {
    logicalId : Text;
    version : Nat64;
    contentHash : Blob;
    userId : Nat64;
    principal : Principal;
    factor : Text;
    provider : ?Text;
    subjectHash : ?Blob;
  };

  type RoleRecord = {
    logicalId : Text;
    version : Nat64;
    contentHash : Blob;
    principal : Principal;
    role : Text;
  };

  public type Store = {
    bindings : ZenDB.Collection<BindingRecord>;
    roles : ZenDB.Collection<RoleRecord>;
  };

  let bindingSchema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("version", #Nat64),
    ("contentHash", #Blob),
    ("userId", #Nat64),
    ("principal", #Principal),
    ("factor", #Text),
    ("provider", #Option(#Text)),
    ("subjectHash", #Option(#Blob)),
  ]);

  let roleSchema : ZenDB.Types.Schema = #Record([
    ("logicalId", #Text),
    ("version", #Nat64),
    ("contentHash", #Blob),
    ("principal", #Principal),
    ("role", #Text),
  ]);

  let bindingCandify : ZenDB.Types.Candify<BindingRecord> = {
    from_blob = func(blob : Blob) : ?BindingRecord { from_candid (blob) };
    to_blob = func(record : BindingRecord) : Blob { to_candid (record) };
  };

  let roleCandify : ZenDB.Types.Candify<RoleRecord> = {
    from_blob = func(blob : Blob) : ?RoleRecord { from_candid (blob) };
    to_blob = func(record : RoleRecord) : Blob { to_candid (record) };
  };

  func bounded(blob : Blob) : Bool {
    Blob.toArray(blob).size() <= StorageCatalog.limits.maxDocumentBytes;
  };

  public func create(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(bindings) = db.createCollection<BindingRecord>(
      "core_principal_binding_v1",
      bindingSchema,
      bindingCandify,
      ?{ schema_constraints = [#Unique(["logicalId"])] },
    ) else return null;
    let #ok(roles) = db.createCollection<RoleRecord>(
      "core_role_assignment_v1",
      roleSchema,
      roleCandify,
      ?{ schema_constraints = [#Unique(["logicalId"])] },
    ) else return null;
    ?{ bindings; roles };
  };

  public func reopen(store : ZenDB.Types.VersionedStableStore) : ?Store {
    let db = ZenDB.launchDefaultDB(store);
    let #ok(bindings) = db.getCollection<BindingRecord>("core_principal_binding_v1", bindingCandify) else return null;
    let #ok(roles) = db.getCollection<RoleRecord>("core_role_assignment_v1", roleCandify) else return null;
    ?{ bindings; roles };
  };

  func bindingFor(input : IdentityRole.PrincipalBindingInput) : BindingRecord {
    {
      logicalId = input.logicalId;
      version = input.desiredVersion;
      contentHash = input.contentHash;
      userId = input.userId;
      principal = input.principal;
      factor = switch (input.factor) { case (#internetIdentity) "internetIdentity"; case (#oauth) "oauth" };
      provider = input.provider;
      subjectHash = input.subjectHash;
    };
  };

  func roleFor(input : IdentityRole.RoleAssignmentInput) : RoleRecord {
    {
      logicalId = input.logicalId;
      version = input.desiredVersion;
      contentHash = input.contentHash;
      principal = input.principal;
      role = input.role;
    };
  };

  func bindingObservation(record : BindingRecord) : ImmutableBindingObservation {
    {
      version = record.version;
      contentHash = record.contentHash;
      userId = record.userId;
      principal = record.principal;
      factor = switch (record.factor) {
        case ("internetIdentity") #internetIdentity;
        case (_) #oauth;
      };
      provider = record.provider;
      subjectHash = record.subjectHash;
    };
  };

  func roleObservation(record : RoleRecord) : ImmutableRoleObservation {
    {
      version = record.version;
      contentHash = record.contentHash;
      principal = record.principal;
      role = record.role;
    };
  };

  /// One complete-tuple decision is shared by focused vectors and the
  /// durable binding duplicate branch.  All identity evidence remains bound
  /// to the logical ID after a lost reply.
  public func decideBindingIdempotentWrite(
    input : IdentityRole.PrincipalBindingInput,
    observed : ?ImmutableBindingObservation,
  ) : WriteResult {
    if (not IdentityRole.validPrincipalBinding(input)) return #blocked;
    switch (observed) {
      case null #conflict;
      case (?(existing)) {
        if (
          existing.version == input.desiredVersion and
          Blob.equal(existing.contentHash, input.contentHash) and
          existing.userId == input.userId and
          existing.principal == input.principal and
          existing.factor == input.factor and
          existing.provider == input.provider and
          existing.subjectHash == input.subjectHash
        ) #acknowledged else #conflict;
      };
    };
  };

  /// One complete-tuple decision is shared by focused vectors and the
  /// durable role duplicate branch.  Role changes require a new immutable
  /// transition rather than an overwritten logical ID.
  public func decideRoleIdempotentWrite(
    input : IdentityRole.RoleAssignmentInput,
    observed : ?ImmutableRoleObservation,
  ) : WriteResult {
    if (not IdentityRole.validRoleAssignment(input)) return #blocked;
    switch (observed) {
      case null #conflict;
      case (?(existing)) {
        if (
          existing.version == input.desiredVersion and
          Blob.equal(existing.contentHash, input.contentHash) and
          existing.principal == input.principal and
          existing.role == input.role
        ) #acknowledged else #conflict;
      };
    };
  };

  public func writeBinding(store : Store, input : IdentityRole.PrincipalBindingInput) : WriteResult {
    if (not IdentityRole.validPrincipalBinding(input)) return #blocked;
    let record = bindingFor(input);
    if (not bounded(to_candid (record))) return #blocked;
    switch (store.bindings.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) { #storageError };
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.bindings.insert(record)) { case (#ok(_)) #acknowledged; case (#err(_)) #storageError };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideBindingIdempotentWrite(input, ?bindingObservation(existing));
        } else {
          #conflict;
        };
      };
    };
  };

  /// The recovery lookup is deliberately fixed to the principal-binding
  /// collection and caps the engine result at two documents.  A duplicated
  /// logical ID is a conflict, never a selection of an arbitrary record.
  public func lookupBinding(store : Store, logicalId : Text) : BindingObservation {
    if (logicalId.size() == 0 or logicalId.size() > 512) return #conflict;
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return #conflict;
    };
    switch (store.bindings.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(2))) {
      case (#err(_)) { #storageError };
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          #absent;
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          #present({ version = existing.version; contentHash = existing.contentHash });
        } else {
          #conflict;
        };
      };
    };
  };

  public func writeRole(store : Store, input : IdentityRole.RoleAssignmentInput) : WriteResult {
    if (not IdentityRole.validRoleAssignment(input)) return #blocked;
    let record = roleFor(input);
    if (not bounded(to_candid (record))) return #blocked;
    switch (store.roles.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(input.logicalId))).Limit(2))) {
      case (#err(_)) { #storageError };
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          switch (store.roles.insert(record)) { case (#ok(_)) #acknowledged; case (#err(_)) #storageError };
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          decideRoleIdempotentWrite(input, ?roleObservation(existing));
        } else {
          #conflict;
        };
      };
    };
  };

  /// Fixed, two-record-bounded recovery lookup for role assignments. As with
  /// bindings, a uniqueness violation is fail-closed instead of selecting an
  /// arbitrary document.
  public func lookupRole(store : Store, logicalId : Text) : RoleObservation {
    if (logicalId.size() == 0 or logicalId.size() > 512) return #conflict;
    for (character in logicalId.chars()) {
      if (character < '\u{20}' or character == '\u{7f}') return #conflict;
    };
    switch (store.roles.search(ZenDB.QueryBuilder().Where("logicalId", #eq(#Text(logicalId))).Limit(2))) {
      case (#err(_)) { #storageError };
      case (#ok(result)) {
        let records = result.documents;
        if (records.size() == 0) {
          #absent;
        } else if (records.size() == 1) {
          let (_, existing, _) = records[0];
          #present({ version = existing.version; contentHash = existing.contentHash });
        } else {
          #conflict;
        };
      };
    };
  };
};
