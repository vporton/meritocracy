import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Principal "mo:base/Principal";

persistent actor MockRegistry {
  type AssetId = { ledger : Principal; symbol : Text; decimals : Nat8 };
  type Route = {
    network : {
      #icp;
      #bitcoin;
      #ethereum;
      #solana;
      #polkadot;
      #stellar;
      #cosmos;
      #bitcoin_cash;
      #other : Text;
    };
    asset : ?AssetId;
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
  type CarriedBalance = {
    asset : AssetId;
    atoms : Nat;
    source_round : Nat64;
    reason : Text;
  };
  type Credit = {
    user_id : Nat64;
    balance : CarriedBalance;
    allocation_id : Nat64;
  };

  var rounds : ?Principal = null;
  var session : ?Principal = null;
  var recipient : ?Account = null;
  var configuredAsset : ?AssetId = null;
  var credits : [Credit] = [];
  var consumed : [(Nat64, Nat64)] = [];
  var failNextConsume : Bool = false;

  public shared func configure(
    input : {
      rounds : Principal;
      session : Principal;
      recipient : Account;
      asset : AssetId;
    }
  ) : async () {
    rounds := ?input.rounds;
    session := ?input.session;
    recipient := ?input.recipient;
    configuredAsset := ?input.asset;
  };

  public shared ({ caller }) func authorize_session(value : Principal) : async {
    #ok : { user_id : Nat64; expires_at : Int };
    #err : AppError;
  } {
    if (rounds != ?caller) return #err(#forbidden);
    if (session != ?value) return #err(#unauthorized);
    #ok({ user_id = 1; expires_at = 9_000_000_000_000_000_000 });
  };

  public shared ({ caller }) func snapshot_recipient(
    input : {
      user_id : Nat64;
      route : Route;
      round_id : Nat64;
    }
  ) : async {
    #ok : {
      user_id : Nat64;
      payout_account_id : Nat64;
      route : Route;
      normalized_address : Text;
      icrc_account : ?Account;
      captured_at : Int;
    };
    #err : AppError;
  } {
    if (rounds != ?caller) return #err(#forbidden);
    if (input.user_id != 1) return #err(#not_found);
    if (input.route.network != #icp or input.route.asset != configuredAsset) return #err(#not_found);
    let ?account = recipient else return #err(#not_found);
    #ok({
      user_id = input.user_id;
      payout_account_id = 1;
      route = input.route;
      normalized_address = Principal.toText(account.owner);
      icrc_account = ?account;
      captured_at = 1_700_000_000_000_000_000;
    });
  };

  public shared ({ caller }) func credit_carried_balance(input : Credit) : async {
    #ok;
    #err : AppError;
  } {
    if (rounds != ?caller) return #err(#forbidden);
    switch (Array.find<Credit>(credits, func(item) { item.allocation_id == input.allocation_id })) {
      case (?existing) {
        if (existing == input) return #ok;
        #err(#conflict("allocation already credited"));
      };
      case null {
        credits := Array.append(credits, [input]);
        #ok;
      };
    };
  };

  public query func carried_credits() : async [Credit] { credits };

  public shared func fail_next_consume() : async () { failNextConsume := true };

  public shared ({ caller }) func consume_carried_balance(input : { allocation_id : Nat64; target_round : Nat64 }) : async {
    #ok : CarriedBalance;
    #err : AppError;
  } {
    if (rounds != ?caller) return #err(#forbidden);
    if (failNextConsume) {
      failNextConsume := false;
      return #err(#transient_("injected carried claim consume failure"));
    };
    let ?credit = Array.find<Credit>(credits, func(item) { item.allocation_id == input.allocation_id }) else return #err(#not_found);
    switch (Array.find<(Nat64, Nat64)>(consumed, func(item) { item.0 == input.allocation_id })) {
      case (?(_, round)) {
        if (round != input.target_round) return #err(#conflict("already consumed"));
      };
      case null consumed := Array.append(consumed, [(input.allocation_id, input.target_round)]);
    };
    #ok(credit.balance);
  };
};
