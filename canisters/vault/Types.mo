import Principal "mo:base/Principal";

module {
  public type RoundId = Nat64;
  public type AllocationId = Nat64;
  public type Hash32 = Blob;
  public type TimestampNs = Int;

  public type AssetId = {
    ledger : Principal;
    symbol : Text;
    decimals : Nat8;
  };
  public type Account = { owner : Principal; subaccount : ?Blob };
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

  public type Reservation = {
    round_id : RoundId;
    asset : AssetId;
    fund : Hash32;
    required_atoms : Nat;
    reserved_atoms : Nat;
    fee_budget_atoms : Nat;
    accounting_deficit_atoms : Nat;
    finalized_outstanding_atoms : ?Nat;
    finalized_outstanding_count : ?Nat32;
    allocation_version : Hash32;
    transfer_count : Nat32;
    account : Account;
  };
  public type TransferState = {
    #prepared;
    #executing : Nat32;
    #sent : Nat;
    #retryable_failure : Text;
    #permanent_failure : Text;
  };
  public type Transfer = {
    allocation_id : AllocationId;
    to : Account;
    amount_atoms : Nat;
    fee_atoms : ?Nat;
    memo : Hash32;
    created_at_time : Nat64;
    state : TransferState;
  };
  public type PreparedTransfer = {
    allocation_id : AllocationId;
    to : Account;
    amount_atoms : Nat;
    memo : Hash32;
    created_at_time : Nat64;
  };
  public type BatchExecution = { round_id : RoundId; transfers : [Transfer] };

  public type RolloverState = {
    #prepared;
    #sent : Nat;
    #retryable_failure : Text;
    #permanent_failure : Text;
  };
  public type Rollover = {
    allocation_id : AllocationId;
    source_round : RoundId;
    target_round : RoundId;
    to : Account;
    amount_atoms : Nat;
    fee_atoms : Nat;
    memo : Hash32;
    created_at_time : Nat64;
    state : RolloverState;
  };

  public type StoredTransfer = {
    round_id : RoundId;
    allocation_version : Hash32;
    attempts : Nat32;
    transfer : Transfer;
  };
  public type BatchRecord = {
    round_id : RoundId;
    allocation_version : Hash32;
    allocation_ids : [AllocationId];
  };
  public type StableState = {
    rounds_canister : ?Principal;
    supported_ledgers : [Principal];
    emergency_paused : Bool;
    reservations : [Reservation];
    transfers : [StoredTransfer];
    batches : [BatchRecord];
    rollovers : [Rollover];
  };

  public let emptyState : StableState = {
    rounds_canister = null;
    supported_ledgers = [];
    emergency_paused = false;
    reservations = [];
    transfers = [];
    batches = [];
    rollovers = [];
  };
};
