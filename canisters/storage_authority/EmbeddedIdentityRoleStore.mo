import Blob "mo:base/Blob";
import ZenDB "mo:zendb";
import IdentityRole "../shared/IdentityRoleRecovery";
import StorageCatalog "../shared/StorageCatalog";

/// A deliberately narrow embedded-store adapter used only by the M1 local
/// proof.  It models the two fixed core collections that carry identity and
/// role records.  It has no actor, Candid surface, grant API, or caller
/// authorization: those remain the responsibility of `storage_authority`.
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
          switch (IdentityRole.decideIdempotentWrite(
            true,
            input.desiredVersion,
            input.contentHash,
            ?{ version = existing.version; contentHash = existing.contentHash },
          )) {
            case (#accept) #acknowledged;
            case (#conflict) #conflict;
            case (#blocked) #blocked;
          };
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
          switch (IdentityRole.decideIdempotentWrite(
            true,
            input.desiredVersion,
            input.contentHash,
            ?{ version = existing.version; contentHash = existing.contentHash },
          )) {
            case (#accept) #acknowledged;
            case (#conflict) #conflict;
            case (#blocked) #blocked;
          };
        } else {
          #conflict;
        };
      };
    };
  };
};
