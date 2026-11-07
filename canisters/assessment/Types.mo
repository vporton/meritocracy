import Principal "mo:base/Principal";

module {
  public type UserId = Nat64;
  public type EvaluationId = Nat64;
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
  public type SourceRef = {
    ordinal : Nat32;
    uri_hash : Hash32;
    allowed_uri : ?Text;
  };
  public type EvaluationOutcome = {
    #accepted : { weight_numerator : Nat; weight_denominator : Nat };
    #rejected : Text;
  };
  public type FailureClass = {
    #provider_unavailable;
    #timeout;
    #malformed_response;
    #policy_rejected;
    #internal;
  };
  public type EvaluationStatus = { #pending; #complete; #failed : FailureClass };
  public type Evaluation = {
    id : EvaluationId;
    idempotency_key : Hash32;
    request_fingerprint : Hash32;
    subject_user_id : UserId;
    input_hash : Hash32;
    source_refs : [SourceRef];
    prompt_version : Hash32;
    model_version : Text;
    result_hash : ?Hash32;
    outcome : ?EvaluationOutcome;
    status : EvaluationStatus;
    attempt : Nat32;
    attempt_token : Hash32;
    created_at : TimestampNs;
    updated_at : TimestampNs;
  };
  public type AllocationProposal = {
    evaluation_id : EvaluationId;
    user_id : UserId;
    weight_numerator : Nat;
    weight_denominator : Nat;
    evidence_hash : Hash32;
  };
  public type Config = {
    submitters : [Principal];
    audit_canister : ?Principal;
    allowed_models : [Text];
    allowed_prompt_versions : [Hash32];
    allowed_source_hosts : [Text];
    max_input_bytes : Nat;
    max_sources : Nat;
    max_weight_numerator : Nat;
    rate_limit_count : Nat32;
    rate_limit_window_ns : Nat64;
    max_attempts : Nat32;
  };
  public type RateWindow = {
    subject_user_id : UserId;
    started_at : TimestampNs;
    count : Nat32;
  };
  public type AuditEvent = {
    id : Nat64;
    evaluation_id : EvaluationId;
    kind : Text;
    payload_hash : Hash32;
    created_at : TimestampNs;
    attempts : Nat32;
    delivered : Bool;
  };
  public type StableState = {
    config : Config;
    next_evaluation_id : EvaluationId;
    next_audit_id : Nat64;
    evaluations : [Evaluation];
    rate_windows : [RateWindow];
    audit_outbox : [AuditEvent];
  };
  public let emptyConfig : Config = {
    submitters = [];
    audit_canister = null;
    allowed_models = [];
    allowed_prompt_versions = [];
    allowed_source_hosts = [];
    max_input_bytes = 65_536;
    max_sources = 32;
    max_weight_numerator = 1_000_000;
    rate_limit_count = 10;
    rate_limit_window_ns = 3_600_000_000_000;
    max_attempts = 3;
  };
  public let emptyState : StableState = {
    config = emptyConfig;
    next_evaluation_id = 1;
    next_audit_id = 1;
    evaluations = [];
    rate_windows = [];
    audit_outbox = [];
  };
};
