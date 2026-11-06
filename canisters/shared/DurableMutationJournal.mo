/// A bounded durable intent/write/acknowledgement journal for an owning actor.
///
/// The intent is written before an external await.  A result is authoritative
/// only after its operation ID and desired content hash have been reconciled
/// and acknowledged.  This is a private module: it creates no Candid surface
/// and never authorizes a caller on its own.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Result "mo:base/Result";

module {
  public let maxIntents : Nat = 128;
  public let maxOperationIdChars : Nat = 256;
  public let currentSchemaVersion : Nat = 1;

  public type Phase = { #prepared; #acknowledged };
  public type Intent = {
    operationId : Text;
    targetLogicalId : Text;
    desiredHash : Blob;
    phase : Phase;
  };
  public type State = { schemaVersion : Nat; intents : [Intent] };
  public type PrepareResult = { #prepared; #duplicate; #acknowledged };
  public type ReconcileResult = { #retryIdentical; #acknowledged };
  public type Error = {
    #invalidOperationId;
    #invalidTargetLogicalId;
    #invalidHash;
    #capacityExceeded;
    #operationConflict;
    #unknownOperation;
    #resultConflict;
    #unsupportedSchemaVersion;
  };

  public let empty : State = {
    schemaVersion = currentSchemaVersion;
    intents = [];
  };

  func validText(value : Text) : Bool {
    value.size() > 0 and value.size() <= maxOperationIdChars
  };
  func validHash(value : Blob) : Bool { value.size() == 32 };
  func sameIntent(intent : Intent, targetLogicalId : Text, desiredHash : Blob) : Bool {
    intent.targetLogicalId == targetLogicalId and Blob.equal(intent.desiredHash, desiredHash);
  };
  func replaceIntent(state : State, replacement : Intent) : State {
    {
      schemaVersion = state.schemaVersion;
      intents = Array.map<Intent, Intent>(
        state.intents,
        func(intent) {
          if (intent.operationId == replacement.operationId) replacement else intent;
        },
      );
    };
  };

  public func prepare(state : State, operationId : Text, targetLogicalId : Text, desiredHash : Blob) : Result.Result<(State, PrepareResult), Error> {
    if (state.schemaVersion != currentSchemaVersion) return #err(#unsupportedSchemaVersion);
    if (not validText(operationId)) return #err(#invalidOperationId);
    if (not validText(targetLogicalId)) return #err(#invalidTargetLogicalId);
    if (not validHash(desiredHash)) return #err(#invalidHash);
    for (intent in state.intents.vals()) {
      if (intent.operationId == operationId) {
        if (not sameIntent(intent, targetLogicalId, desiredHash)) return #err(#operationConflict);
        switch (intent.phase) {
          case (#prepared) return #ok((state, #duplicate));
          case (#acknowledged) return #ok((state, #acknowledged));
        };
      };
    };
    if (state.intents.size() >= maxIntents) return #err(#capacityExceeded);
    let intent : Intent = {
      operationId;
      targetLogicalId;
      desiredHash;
      phase = #prepared;
    };
    #ok(({ schemaVersion = state.schemaVersion; intents = Array.append(state.intents, [intent]) }, #prepared));
  };

  /// Call only after an external response, or a query of the authoritative
  /// remote ledger, proves the exact operation ID and desired hash.
  public func acknowledge(state : State, operationId : Text, observedHash : Blob) : Result.Result<State, Error> {
    if (state.schemaVersion != currentSchemaVersion) return #err(#unsupportedSchemaVersion);
    for (intent in state.intents.vals()) {
      if (intent.operationId == operationId) {
        if (not Blob.equal(intent.desiredHash, observedHash)) return #err(#resultConflict);
        return #ok(replaceIntent(state, { intent with phase = #acknowledged }));
      };
    };
    #err(#unknownOperation);
  };

  /// An absent remote result permits only the identical retry.  Any different
  /// remote result is a conflict; it never creates fresh transaction material.
  public func reconcile(state : State, operationId : Text, remoteHash : ?Blob) : Result.Result<(State, ReconcileResult), Error> {
    switch (remoteHash) {
      case null {
        for (intent in state.intents.vals()) {
          if (intent.operationId == operationId) {
            switch (intent.phase) {
              case (#prepared) return #ok((state, #retryIdentical));
              case (#acknowledged) return #ok((state, #acknowledged));
            };
          };
        };
        #err(#unknownOperation);
      };
      case (?hash) {
        switch (acknowledge(state, operationId, hash)) {
          case (#ok(next)) #ok((next, #acknowledged));
          case (#err(error)) #err(error);
        };
      };
    };
  };

  public func isAcknowledged(state : State, operationId : Text) : Bool {
    for (intent in state.intents.vals()) {
      if (intent.operationId == operationId) {
        switch (intent.phase) {
          case (#acknowledged) return true;
          case (#prepared) return false;
        };
      };
    };
    false;
  };
};
