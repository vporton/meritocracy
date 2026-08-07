import Principal "mo:base/Principal";

/// One disposable proof coordinator keeps the local-replica run bounded while
/// preserving the actual caller principals of the three caller fixtures. The
/// storage authority still observes `core`, `governance`, and `unrelated` as
/// its direct inter-canister callers; this actor only collects their results.
shared ({ caller = installer }) persistent actor class (
  core : Principal,
  governance : Principal,
  unrelated : Principal,
) {
  assert not Principal.isAnonymous(installer);
  assert not Principal.isAnonymous(core);
  assert not Principal.isAnonymous(governance);
  assert not Principal.isAnonymous(unrelated);

  type ProbeResult = {
    #allowed;
    #anonymousCaller;
    #callerNotAllowed;
    #invalidConfiguration;
    #malformedLogicalId;
  };

  type DataOperation = {
    #coreRead;
    #coreWrite;
    #treasuryWrite;
  };

  type PolicyAudit = {
    archive : Principal;
    core : Principal;
    evidence : Principal;
    governance : Principal;
    treasury : Principal;
    workflow : Principal;
  };

  type Caller = actor {
    audit : shared () -> async ?PolicyAudit;
    data : shared (DataOperation, Text) -> async ProbeResult;
  };

  let coreCaller : Caller = actor (Principal.toText(core));
  let governanceCaller : Caller = actor (Principal.toText(governance));
  let unrelatedCaller : Caller = actor (Principal.toText(unrelated));

  public shared ({ caller }) func verify(logicalId : Text) : async Bool {
    assert not Principal.isAnonymous(caller);

    (await coreCaller.data(#coreRead, logicalId)) == #allowed and
    (await coreCaller.data(#coreWrite, logicalId)) == #allowed and
    (await coreCaller.data(#treasuryWrite, logicalId)) == #callerNotAllowed and
    (await coreCaller.data(#coreRead, "bad\nlogical-id")) == #malformedLogicalId and
    (await coreCaller.audit()) == null and
    (await governanceCaller.data(#coreRead, logicalId)) == #callerNotAllowed and
    (await governanceCaller.audit()) != null and
    (await unrelatedCaller.data(#coreRead, logicalId)) == #callerNotAllowed;
  };
};
