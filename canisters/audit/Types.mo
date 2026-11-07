module {
  public type UserId = Nat64;
  public type RoundId = Nat64;
  public type TimestampNs = Int;
  public type Hash32 = Blob;
  public type AppError = {
    #unauthorized;
    #forbidden;
    #not_found;
    #conflict : Text;
    #invalid : Text;
    #expired;
    #rate_limited : { retry_after_ns : Nat64 };
    #paused;
    #transient_ : Text;
    #internal : Text;
  };
  public type AuditSubject = {
    #user : UserId;
    #round : RoundId;
    #allocation : Nat64;
    #evaluation : Nat64;
    #system_ : Text;
  };
  public type AuditKind = {
    #session;
    #profile;
    #attestation;
    #evaluation;
    #round;
    #dispute;
    #transfer;
    #reconciliation;
    #governance;
  };
  public type AuditEvent = {
    event_id : Hash32;
    occurred_at : TimestampNs;
    actor_ : Principal;
    subject : AuditSubject;
    kind : AuditKind;
    payload_hash : Hash32;
    public_payload : Blob;
  };
  public type EventFilter = {
    subject : ?AuditSubject;
    kind : ?AuditKind;
    from : ?TimestampNs;
    to : ?TimestampNs;
  };
  public type AuditPage = { items : [AuditEvent]; next_cursor : ?Blob };
  public type RoundReport = {
    round_id : RoundId;
    event_count : Nat64;
    last_event_at : ?TimestampNs;
    event_root : Hash32;
  };
  public type UserReport = { user_id : UserId; events : AuditPage };
  public type StableState = { appenders : [Principal]; events : [AuditEvent] };
  public let emptyState : StableState = { appenders = []; events = [] };
};
