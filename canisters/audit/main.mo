import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import State "State";
import Types "Types";

persistent actor Audit {
  type Result<T> = { #ok : T; #err : Types.AppError };
  type UnitResult = { #ok; #err : Types.AppError };
  var stableState : Types.StableState = Types.emptyState;
  public query func interface_version() : async {
    major : Nat16;
    minor : Nat16;
    patch : Nat16;
    schema_hash : Blob;
  } {
    {
      major = 1;
      minor = 2;
      patch = 0;
      schema_hash = Blob.fromArray([
        0xf8,
        0x32,
        0x76,
        0x70,
        0xd3,
        0x54,
        0xdf,
        0x75,
        0x2b,
        0xc3,
        0x90,
        0x44,
        0x91,
        0xd0,
        0x8b,
        0x63,
        0x1d,
        0x2e,
        0xc4,
        0x3f,
        0xe5,
        0xcc,
        0x9f,
        0xbb,
        0x3c,
        0xe2,
        0xe0,
        0x58,
        0xce,
        0x2d,
        0x66,
        0xae,
      ]);
    };
  };
  public shared ({ caller }) func configure_authorities(config : { appenders : [Principal] }) : async UnitResult {
    if (not Principal.isController(caller)) return #err(#forbidden);
    let store = State.Store(stableState);
    switch (store.configureAppenders(config.appenders)) {
      case (#err(error)) #err(error);
      case (#ok(())) { stableState := store.snapshot(); #ok };
    };
  };
  public shared ({ caller }) func append(event : Types.AuditEvent) : async Result<Types.AuditEvent> {
    let store = State.Store(stableState);
    if (not store.isAppender(caller) or event.actor_ != caller) return #err(#forbidden);
    switch (store.append(event)) {
      case (#err(error)) #err(error);
      case (#ok(value)) { stableState := store.snapshot(); #ok(value) };
    };
  };
  public query func get_event(eventId : Blob) : async Result<Types.AuditEvent> {
    switch (State.Store(stableState).getEvent(eventId)) {
      case null #err(#not_found);
      case (?event) #ok(event);
    };
  };
  public query func list_events(input : { subject : ?Types.AuditSubject; kind : ?Types.AuditKind; from : ?Types.TimestampNs; to : ?Types.TimestampNs; page : { cursor : ?Blob; limit : Nat32 } }) : async Result<Types.AuditPage> {
    State.Store(stableState).listEvents({ subject = input.subject; kind = input.kind; from = input.from; to = input.to }, input.page.cursor, input.page.limit);
  };
  public query func report_round(roundId : Types.RoundId) : async Result<Types.RoundReport> {
    State.Store(stableState).reportRound(roundId);
  };
  public query func report_user(userId : Types.UserId, page : { cursor : ?Blob; limit : Nat32 }) : async Result<Types.UserReport> {
    State.Store(stableState).reportUser(userId, page.cursor, page.limit);
  };
  public query func storage_stats() : async {
    events : Nat64;
    public_payload_bytes : Nat64;
  } {
    State.Store(stableState).stats();
  };
};
