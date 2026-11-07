import Principal "mo:base/Principal";

module {
  public type RoundId = Nat64;
  public type AllocationId = Nat64;
  public type UserId = Nat64;
  public type Hash32 = Blob;
  public type TimestampNs = Int;
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type AssetId = { ledger : Principal; symbol : Text; decimals : Nat8 };
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

  public type RoundStatus = {
    #draft;
    #funded;
    #disputing;
    #executing;
    #complete;
    #paused;
  };
  public type Round = {
    id : RoundId;
    asset : AssetId;
    source_fund : Hash32;
    status : RoundStatus;
    dispute_ends_at : ?TimestampNs;
    required_atoms : Nat;
    reserved_atoms : Nat;
    vault_subaccount : Blob;
    allocation_version : ?Hash32;
  };
  public type AllocationDraft = {
    id : AllocationId;
    user_id : UserId;
    amount_atoms : Nat;
    evidence_hash : Hash32;
  };
  public type AllocationState = {
    #pending;
    #frozen;
    #paid : Nat;
    #carried : Text;
  };
  public type Allocation = {
    draft : AllocationDraft;
    recipient_hash : ?Hash32;
    state : AllocationState;
  };
  public type AllocationVersion = {
    round_id : RoundId;
    hash : Hash32;
    previous : ?Hash32;
    allocations : [AllocationDraft];
    created_at : TimestampNs;
  };

  // Captured before execution and never recomputed during retries.
  public type Recipient = {
    account : Account;
    recipient_hash : Hash32;
    memo : Hash32;
    created_at_time : Nat64;
  };
  public type ExecutionState = {
    #prepared;
    #executing : Nat32;
    #retryable : Text;
    #paid : Nat;
    #carried : Text;
    #frozen;
  };
  public type OperationalAllocation = {
    round_id : RoundId;
    allocation : Allocation;
    recipient : ?Recipient;
    attempts : Nat32;
    execution : ExecutionState;
  };

  public type DisputeState = { #open; #upheld; #rejected };
  public type Dispute = {
    id : Nat64;
    round_id : RoundId;
    allocation_id : AllocationId;
    evidence_hash : Hash32;
    reason_code : Text;
    state : DisputeState;
    created_at : TimestampNs;
  };
  public type DisputeResolution = { #uphold; #reject };

  public type AuditEvent = {
    id : Nat64;
    round_id : RoundId;
    kind : Text;
    payload_hash : Hash32;
    created_at : TimestampNs;
    attempts : Nat32;
    delivered : Bool;
  };
  public type RolloverBinding = {
    source_allocation_id : AllocationId;
    source_round : RoundId;
    target_round : RoundId;
    target_allocation_id : AllocationId;
    target_allocation_version : Hash32;
  };
  public type AuthorityConfig = {
    managers : [Principal];
    dispute_resolvers : [Principal];
  };
  public type StableState = {
    authorities : AuthorityConfig;
    next_round_id : RoundId;
    next_dispute_id : Nat64;
    next_audit_id : Nat64;
    rounds : [Round];
    versions : [AllocationVersion];
    allocations : [OperationalAllocation];
    disputes : [Dispute];
    audit_outbox : [AuditEvent];
    rollover_bindings : [RolloverBinding];
  };

  public let emptyState : StableState = {
    authorities = { managers = []; dispute_resolvers = [] };
    next_round_id = 1;
    next_dispute_id = 1;
    next_audit_id = 1;
    rounds = [];
    versions = [];
    allocations = [];
    disputes = [];
    audit_outbox = [];
    rollover_bindings = [];
  };
};
