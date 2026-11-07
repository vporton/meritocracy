import Principal "mo:base/Principal";

module {
  public type UserId = Nat64;
  public type PayoutAccountId = Nat64;
  public type RoundId = Nat64;
  public type AllocationId = Nat64;
  public type TimestampNs = Int;
  public type Hash32 = Blob;

  public type NetworkId = {
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

  public type AssetId = {
    ledger : Principal;
    symbol : Text;
    decimals : Nat8;
  };

  public type Route = {
    network : NetworkId;
    asset : ?AssetId;
  };

  public type UserStatus = {
    #active;
    #banned : TimestampNs;
    #deleted;
  };

  public type PublicProfile = {
    user_id : UserId;
    name : ?Text;
    created_at : TimestampNs;
    status : UserStatus;
  };

  public type EligibilityStatus = {
    #unknown;
    #eligible;
    #ineligible;
    #expired;
  };

  public type EligibilityState = {
    status : EligibilityStatus;
    issuer : ?Text;
    reference_hash : ?Hash32;
    expires_at : ?TimestampNs;
  };

  public type User = {
    profile : PublicProfile;
    eligibility : EligibilityState;
  };

  // A migration mapping is an administrative association only. It does not
  // bind an OAuth subject, wallet, email, session principal, or KYC evidence.
  public type LegacyUserMapping = {
    source_namespace : Text;
    legacy_user_id : Text;
    user_id : UserId;
    imported_profile : {
      name : ?Text;
      created_at : TimestampNs;
      status : UserStatus;
    };
  };

  public type SessionIssuer = {
    #ethereum_wallet;
    #internet_identity;
    #oauth : Text;
  };

  public type Session = {
    session_principal : Principal;
    user_id : UserId;
    issuer : SessionIssuer;
    issued_at : TimestampNs;
    expires_at : TimestampNs;
    revoked_at : ?TimestampNs;
  };

  // Identity identifiers are normalized by the issuer adapter and committed as
  // 32-byte hashes. Raw OAuth tokens and wallet signatures never belong here.
  public type IdentityBinding = {
    issuer : SessionIssuer;
    subject_hash : Hash32;
    user_id : UserId;
  };

  public type EthereumLoginChallenge = {
    challenge_id : Blob;
    normalized_address : Text;
    session_principal : Principal;
    requested_action : Text;
    domain : Text;
    message : Text;
    issued_at : TimestampNs;
    expires_at : TimestampNs;
    consumed_at : ?TimestampNs;
  };

  // Provider credentials and PKCE verifiers are deliberately excluded. This
  // record only binds a short-lived browser attempt to its target session.
  public type OAuthAttempt = {
    attempt_id : Blob;
    provider : Text;
    session_principal : Principal;
    redirect_uri : Text;
    issued_at : TimestampNs;
    expires_at : TimestampNs;
    consumed_at : ?TimestampNs;
  };

  public type VerificationState = {
    #pending;
    #legacy_imported;
    #verified;
    #revoked;
  };

  public type PayoutAccount = {
    id : PayoutAccountId;
    user_id : UserId;
    route : Route;
    address : Text;
    normalized_address : Text;
    verification : VerificationState;
    active : Bool;
    default_for_route : Bool;
    created_at : TimestampNs;
    verified_at : ?TimestampNs;
  };

  public type IcrcAccount = {
    owner : Principal;
    subaccount : ?Blob;
  };

  public type RecipientSnapshot = {
    user_id : UserId;
    payout_account_id : PayoutAccountId;
    route : Route;
    normalized_address : Text;
    icrc_account : ?IcrcAccount;
    captured_at : TimestampNs;
  };

  public type RecipientSnapshotRecord = {
    round_id : RoundId;
    snapshot : RecipientSnapshot;
  };

  public type PayoutProofChallenge = {
    challenge_id : Blob;
    payout_account_id : PayoutAccountId;
    user_id : UserId;
    session_principal : Principal;
    message : Text;
    issued_at : TimestampNs;
    expires_at : TimestampNs;
    consumed_at : ?TimestampNs;
  };

  public type CarriedBalance = {
    asset : AssetId;
    atoms : Nat;
    source_round : RoundId;
    reason : Text;
  };

  public type CarriedCredit = {
    allocation_id : AllocationId;
    user_id : UserId;
    balance : CarriedBalance;
    consumed_by_round : ?RoundId;
  };

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

  // Arrays and scalar counters are stable Motoko types. The actor stores one
  // value of this type and replaces it only through Store.snapshot().
  public type StableState = {
    next_user_id : UserId;
    next_payout_account_id : PayoutAccountId;
    users : [User];
    sessions : [Session];
    identity_bindings : [IdentityBinding];
    ethereum_login_challenges : [EthereumLoginChallenge];
    oauth_attempts : [OAuthAttempt];
    payout_accounts : [PayoutAccount];
    payout_proof_challenges : [PayoutProofChallenge];
    recipient_snapshots : [RecipientSnapshotRecord];
    carried_credits : [CarriedCredit];
    legacy_user_mappings : [LegacyUserMapping];
  };

  public let unknownEligibility : EligibilityState = {
    status = #unknown;
    issuer = null;
    reference_hash = null;
    expires_at = null;
  };

  public let emptyState : StableState = {
    next_user_id = 1;
    next_payout_account_id = 1;
    users = [];
    sessions = [];
    identity_bindings = [];
    ethereum_login_challenges = [];
    oauth_attempts = [];
    payout_accounts = [];
    payout_proof_challenges = [];
    recipient_snapshots = [];
    carried_credits = [];
    legacy_user_mappings = [];
  };
};
