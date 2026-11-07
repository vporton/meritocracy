import Principal "mo:base/Principal";

persistent actor MockRounds {
  type RoundId = Nat64;
  type AllocationId = Nat64;
  type Hash32 = Blob;
  type AssetId = {
    ledger : Principal;
    symbol : Text;
    decimals : Nat8;
  };
  type Account = { owner : Principal; subaccount : ?Blob };
  type AppError = {
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
  type Reservation = {
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
  type Transfer = {
    allocation_id : AllocationId;
    to : Account;
    amount_atoms : Nat;
    fee_atoms : ?Nat;
    memo : Hash32;
    created_at_time : Nat64;
    state : {
      #prepared;
      #executing : Nat32;
      #sent : Nat;
      #retryable_failure : Text;
      #permanent_failure : Text;
    };
  };
  type PreparedTransfer = {
    allocation_id : AllocationId;
    to : Account;
    amount_atoms : Nat;
    memo : Hash32;
    created_at_time : Nat64;
  };
  type BatchExecution = { round_id : RoundId; transfers : [Transfer] };
  type ResultReservation = { #ok : Reservation; #err : AppError };
  type ResultBatch = { #ok : BatchExecution; #err : AppError };

  type Vault = actor {
    reserve_round : shared {
      round_id : RoundId;
      asset : AssetId;
      fund : Hash32;
      required_atoms : Nat;
      allocation_version : Hash32;
      transfer_count : Nat32;
    } -> async ResultReservation;
    execute_batch : shared {
      round_id : RoundId;
      allocation_version : Hash32;
      transfers : [PreparedTransfer];
    } -> async ResultBatch;
    close_round : shared {
      round_id : RoundId;
      outstanding_atoms : Nat;
      outstanding_count : Nat32;
    } -> async ResultReservation;
  };

  var vaultPrincipal : ?Principal = null;

  public shared func configure_vault(vault : Principal) : async () {
    vaultPrincipal := ?vault;
  };

  public shared func reserve_round(
    input : {
      round_id : RoundId;
      asset : AssetId;
      fund : Hash32;
      required_atoms : Nat;
      allocation_version : Hash32;
      transfer_count : Nat32;
    }
  ) : async ResultReservation {
    let ?vault = configuredVault() else return #err(#invalid("vault is not configured"));
    await vault.reserve_round(input);
  };

  public shared func execute_batch(
    input : {
      round_id : RoundId;
      allocation_version : Hash32;
      transfers : [PreparedTransfer];
    }
  ) : async ResultBatch {
    let ?vault = configuredVault() else return #err(#invalid("vault is not configured"));
    await vault.execute_batch(input);
  };

  public shared func close_round(input : { round_id : RoundId; outstanding_atoms : Nat; outstanding_count : Nat32 }) : async ResultReservation {
    let ?vault = configuredVault() else return #err(#invalid("vault is not configured"));
    await vault.close_round(input);
  };

  func configuredVault() : ?Vault {
    switch (vaultPrincipal) {
      case null null;
      case (?principal) ?actor (Principal.toText(principal));
    };
  };
};
