import Principal "mo:base/Principal";

module {
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  public type TransferArgs = {
    from_subaccount : ?Blob;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  public type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };

  public type TransferResult = {
    #Ok : Nat;
    #Err : TransferError;
  };

  public type Ledger = actor {
    icrc1_balance_of : shared query Account -> async Nat;
    icrc1_fee : shared query () -> async Nat;
    icrc1_transfer : shared TransferArgs -> async TransferResult;
  };

  public type ErrorClass = {
    #duplicate : Nat;
    #bad_fee : Nat;
    #retryable : Text;
    #permanent : Text;
  };

  public func ledger(principal : Principal) : Ledger {
    actor (Principal.toText(principal));
  };

  public func successfulBlock(result : TransferResult) : ?Nat {
    switch (result) {
      case (#Ok(blockIndex)) ?blockIndex;
      case (#Err(#Duplicate({ duplicate_of }))) ?duplicate_of;
      case _ null;
    };
  };

  public func classify(error : TransferError) : ErrorClass {
    switch (error) {
      case (#Duplicate({ duplicate_of })) #duplicate(duplicate_of);
      case (#BadFee({ expected_fee })) #bad_fee(expected_fee);
      case (#TemporarilyUnavailable) #retryable("ledger temporarily unavailable");
      case (#GenericError({ error_code; message })) {
        // ICRC-1 leaves generic error codes ledger-specific. They are not
        // retryable without an explicit per-ledger allowlist.
        #permanent("ledger error " # debug_show (error_code) # ": " # message);
      };
      case (#BadBurn({ min_burn_amount })) #permanent("amount is below the ledger minimum burn amount " # debug_show (min_burn_amount));
      case (#InsufficientFunds({ balance })) #permanent("insufficient ledger funds; balance " # debug_show (balance));
      case (#TooOld) #permanent("transfer timestamp is too old");
      case (#CreatedInFuture({ ledger_time })) #permanent("transfer timestamp is in the future relative to ledger time " # debug_show (ledger_time));
    };
  };
};
