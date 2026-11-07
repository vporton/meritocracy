import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";

persistent actor MockIcrc1Ledger {
  type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  type TransferArgs = {
    from_subaccount : ?Blob;
    to : Account;
    amount : Nat;
    fee : ?Nat;
    memo : ?Blob;
    created_at_time : ?Nat64;
  };

  type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };

  type TransferResult = {
    #Ok : Nat;
    #Err : TransferError;
  };

  type Completed = {
    caller : Principal;
    args : TransferArgs;
    block_index : Nat;
  };

  var balances : [(Account, Nat)] = [];
  var completed : [Completed] = [];
  var configuredFee : Nat = 10_000;
  var feeOnNextTransfer : ?Nat = null;
  var failNextTemporary : Bool = false;
  var transferCallCount : Nat = 0;
  var successfulTransferCount : Nat = 0;
  var nextBlockIndex : Nat = 0;

  public shared func mint(account : Account, amount : Nat) : async () {
    putBalance(account, balanceOf(account) + amount);
  };

  public shared func set_fee(fee : Nat) : async () {
    configuredFee := fee;
  };

  public shared func change_fee_on_next_transfer(fee : Nat) : async () {
    feeOnNextTransfer := ?fee;
  };

  public shared func fail_next_temporary() : async () {
    failNextTemporary := true;
  };

  public query func transfer_call_count() : async Nat {
    transferCallCount;
  };

  public query func successful_transfer_count() : async Nat {
    successfulTransferCount;
  };

  public query func icrc1_balance_of(account : Account) : async Nat {
    balanceOf(account);
  };

  public query func icrc1_fee() : async Nat {
    configuredFee;
  };

  public shared ({ caller }) func icrc1_transfer(args : TransferArgs) : async TransferResult {
    transferCallCount += 1;

    switch (feeOnNextTransfer) {
      case (?fee) {
        configuredFee := fee;
        feeOnNextTransfer := null;
      };
      case null {};
    };

    switch (Array.find<Completed>(completed, func(entry) { entry.caller == caller and equalArgs(entry.args, args) })) {
      case (?entry) return #Err(#Duplicate({ duplicate_of = entry.block_index }));
      case null {};
    };

    if (failNextTemporary) {
      failNextTemporary := false;
      return #Err(#TemporarilyUnavailable);
    };

    switch (args.fee) {
      case (?fee) if (fee != configuredFee) return #Err(#BadFee({ expected_fee = configuredFee }));
      case _ {};
    };

    let from : Account = { owner = caller; subaccount = args.from_subaccount };
    let fromBalance = balanceOf(from);
    let debit = args.amount + configuredFee;
    if (fromBalance < debit) return #Err(#InsufficientFunds({ balance = fromBalance }));

    putBalance(from, fromBalance - debit);
    putBalance(args.to, balanceOf(args.to) + args.amount);
    let blockIndex = nextBlockIndex;
    nextBlockIndex += 1;
    successfulTransferCount += 1;
    completed := Array.append(completed, [{ caller; args; block_index = blockIndex }]);
    #Ok(blockIndex);
  };

  func balanceOf(account : Account) : Nat {
    switch (Array.find<(Account, Nat)>(balances, func(entry) { equalAccount(entry.0, account) })) {
      case (?entry) entry.1;
      case null 0;
    };
  };

  func putBalance(account : Account, amount : Nat) {
    balances := Array.append(
      Array.filter<(Account, Nat)>(balances, func(entry) { not equalAccount(entry.0, account) }),
      [(account, amount)],
    );
  };

  func equalAccount(left : Account, right : Account) : Bool {
    left.owner == right.owner and equalOptionalBlob(left.subaccount, right.subaccount);
  };

  func equalArgs(left : TransferArgs, right : TransferArgs) : Bool {
    equalOptionalBlob(left.from_subaccount, right.from_subaccount) and equalAccount(left.to, right.to) and left.amount == right.amount and left.fee == right.fee and equalOptionalBlob(left.memo, right.memo) and left.created_at_time == right.created_at_time;
  };

  func equalOptionalBlob(left : ?Blob, right : ?Blob) : Bool {
    switch (left, right) {
      case (null, null) true;
      case (?leftBlob, ?rightBlob) Blob.equal(leftBlob, rightBlob);
      case _ false;
    };
  };
};
