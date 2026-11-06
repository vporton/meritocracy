import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export type AppError = { 'conflict' : string } |
  { 'expired' : null } |
  { 'internal' : string } |
  { 'invalid' : string } |
  { 'rate_limited' : { 'retry_after_ns' : bigint } } |
  { 'forbidden' : null } |
  { 'transient' : string } |
  { 'not_found' : null } |
  { 'unauthorized' : null } |
  { 'paused' : null };
export interface AssetId {
  'decimals' : number,
  'ledger' : Principal,
  'symbol' : string,
}
export interface AuthorityConfig {
  'rounds_canister' : [] | [Principal],
  'session_consumers' : Array<Principal>,
  'attestation_issuers' : Array<{
    'name' : string,
    'caller' : Principal,
    'public_key' : Uint8Array | number[],
  }>,
  'allowed_domains' : Array<string>,
  'allowed_actions' : Array<string>,
}
export interface CarriedBalance {
  'asset' : AssetId,
  'atoms' : bigint,
  'source_round' : RoundId,
  'reason' : string,
}
export interface Challenge {
  'message' : string,
  'challenge_id' : Uint8Array | number[],
  'expires_at' : TimestampNs,
}
export interface EligibilityState {
  'status' : { 'expired' : null } |
    { 'ineligible' : null } |
    { 'eligible' : null } |
    { 'unknown' : null },
  'reference_hash' : [] | [Hash32],
  'issuer' : [] | [string],
  'expires_at' : [] | [TimestampNs],
}
export type Hash32 = Uint8Array | number[];
export type HeaderField = [string, string];
export interface HttpRequest {
  'url' : string,
  'method' : string,
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'certificate_version' : [] | [number],
}
export interface HttpResponse {
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'upgrade' : [] | [boolean],
  'streaming_strategy' : [] | [StreamingStrategy],
  'status_code' : number,
}
export interface HttpUpdateRequest {
  'url' : string,
  'method' : string,
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
}
export interface HttpUpdateResponse {
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'streaming_strategy' : [] | [StreamingStrategy],
  'status_code' : number,
}
export interface InterfaceVersion {
  'major' : number,
  'minor' : number,
  'patch' : number,
  'schema_hash' : Hash32,
}
export type NetworkId = { 'icp' : null } |
  { 'polkadot' : null } |
  { 'solana' : null } |
  { 'other' : string } |
  { 'ethereum' : null } |
  { 'stellar' : null } |
  { 'bitcoin_cash' : null } |
  { 'cosmos' : null } |
  { 'bitcoin' : null };
export interface OAuthStart {
  'login_url' : string,
  'attempt_id' : Uint8Array | number[],
  'expires_at' : TimestampNs,
}
export interface Page {
  'cursor' : [] | [Uint8Array | number[]],
  'limit' : number,
}
export interface PayoutAccount {
  'id' : PayoutAccountId,
  'active' : boolean,
  'created_at' : TimestampNs,
  'user_id' : UserId,
  'normalized_address' : string,
  'default_for_route' : boolean,
  'address' : string,
  'verified_at' : [] | [TimestampNs],
  'verification' : { 'verified' : null } |
    { 'revoked' : null } |
    { 'pending' : null } |
    { 'legacy_imported' : null },
  'route' : Route,
}
export type PayoutAccountId = bigint;
export interface PayoutAccountInput { 'address' : string, 'route' : Route }
export interface ProfilePage {
  'next_cursor' : [] | [Uint8Array | number[]],
  'items' : Array<PublicProfile>,
}
export interface ProfilePatch { 'name' : [] | [string] }
export interface PublicProfile {
  'status' : { 'deleted' : null } |
    { 'active' : null } |
    { 'banned' : TimestampNs },
  'name' : [] | [string],
  'created_at' : TimestampNs,
  'user_id' : UserId,
}
export interface RecipientSnapshot {
  'payout_account_id' : PayoutAccountId,
  'user_id' : UserId,
  'normalized_address' : string,
  'captured_at' : TimestampNs,
  'route' : Route,
}
export type ResultAccount = { 'ok' : PayoutAccount } |
  { 'err' : AppError };
export type ResultAccounts = { 'ok' : Array<PayoutAccount> } |
  { 'err' : AppError };
export type ResultAuthorization = {
    'ok' : { 'user_id' : UserId, 'expires_at' : TimestampNs }
  } |
  { 'err' : AppError };
export type ResultBalances = { 'ok' : Array<CarriedBalance> } |
  { 'err' : AppError };
export type ResultChallenge = { 'ok' : Challenge } |
  { 'err' : AppError };
export type ResultEligibility = { 'ok' : EligibilityState } |
  { 'err' : AppError };
export type ResultOAuth = { 'ok' : OAuthStart } |
  { 'err' : AppError };
export type ResultProfile = { 'ok' : PublicProfile } |
  { 'err' : AppError };
export type ResultProfiles = { 'ok' : ProfilePage } |
  { 'err' : AppError };
export type ResultRecipient = { 'ok' : RecipientSnapshot } |
  { 'err' : AppError };
export type ResultSession = { 'ok' : Session } |
  { 'err' : AppError };
export type ResultUnit = { 'ok' : null } |
  { 'err' : AppError };
export type ResultUser = { 'ok' : User } |
  { 'err' : AppError };
export type RoundId = bigint;
export interface Route { 'asset' : [] | [AssetId], 'network' : NetworkId }
export interface Session {
  'issued_at' : TimestampNs,
  'user_id' : UserId,
  'revoked_at' : [] | [TimestampNs],
  'issuer' : { 'oauth' : string } |
    { 'ethereum_wallet' : null } |
    { 'internet_identity' : null },
  'session_principal' : Principal,
  'expires_at' : TimestampNs,
}
export interface SignedAttestation {
  'status' : { 'ineligible' : null } |
    { 'eligible' : null },
  'signature' : Uint8Array | number[],
  'issued_at' : TimestampNs,
  'reference_hash' : Hash32,
  'user_id' : UserId,
  'issuer' : string,
  'expires_at' : [] | [TimestampNs],
}
export interface StreamingCallbackResponse {
  'token' : [] | [Uint8Array | number[]],
  'body' : Uint8Array | number[],
}
export type StreamingStrategy = {
    'Callback' : {
      'token' : Uint8Array | number[],
      'callback' : [Principal, string],
    }
  };
export type TimestampNs = bigint;
export interface User {
  'eligibility' : EligibilityState,
  'profile' : PublicProfile,
}
export type UserId = bigint;
export interface _SERVICE {
  'add_payout_account' : ActorMethod<[PayoutAccountInput], ResultAccount>,
  'authorize_session' : ActorMethod<[Principal], ResultAuthorization>,
  'configure_authorities' : ActorMethod<[AuthorityConfig], ResultUnit>,
  'begin_ethereum_login' : ActorMethod<
    [
      {
        'domain' : string,
        'requested_action' : string,
        'address' : string,
        'session_principal' : Principal,
      },
    ],
    ResultChallenge
  >,
  'begin_oauth_login' : ActorMethod<
    [
      {
        'provider' : string,
        'redirect_uri' : string,
        'session_principal' : Principal,
      },
    ],
    ResultOAuth
  >,
  'begin_payout_proof' : ActorMethod<[PayoutAccountId], ResultChallenge>,
  'complete_ethereum_login' : ActorMethod<
    [
      {
        'signature' : Uint8Array | number[],
        'public_key' : Uint8Array | number[],
        'challenge_id' : Uint8Array | number[],
      },
    ],
    ResultSession
  >,
  'complete_internet_identity_login' : ActorMethod<
    [{ 'requested_action' : string, 'session_principal' : Principal }],
    ResultSession
  >,
  'complete_payout_proof' : ActorMethod<
    [PayoutAccountId, Uint8Array | number[]],
    ResultAccount
  >,
  'credit_carried_balance' : ActorMethod<
    [
      {
        'balance' : CarriedBalance,
        'allocation_id' : bigint,
        'user_id' : UserId,
      },
    ],
    ResultUnit
  >,
  'get_carried_balances' : ActorMethod<[UserId], ResultBalances>,
  'get_eligibility' : ActorMethod<[UserId], ResultEligibility>,
  'get_public_profile' : ActorMethod<[UserId], ResultProfile>,
  'http_request' : ActorMethod<[HttpRequest], HttpResponse>,
  'http_request_update' : ActorMethod<[HttpUpdateRequest], HttpUpdateResponse>,
  'import_legacy_payout_account' : ActorMethod<
    [UserId, PayoutAccountInput],
    ResultAccount
  >,
  'interface_version' : ActorMethod<[], InterfaceVersion>,
  'list_my_payout_accounts' : ActorMethod<[], ResultAccounts>,
  'list_public_profiles' : ActorMethod<[Page], ResultProfiles>,
  'me' : ActorMethod<[], ResultUser>,
  'put_attestation' : ActorMethod<[SignedAttestation], ResultEligibility>,
  'revoke_all_sessions' : ActorMethod<[], ResultUnit>,
  'revoke_payout_account' : ActorMethod<[PayoutAccountId], ResultAccount>,
  'revoke_session' : ActorMethod<[Principal], ResultUnit>,
  'set_default_payout_account' : ActorMethod<[PayoutAccountId], ResultAccount>,
  'set_payout_account_active' : ActorMethod<
    [PayoutAccountId, boolean],
    ResultAccount
  >,
  'snapshot_recipient' : ActorMethod<
    [{ 'user_id' : UserId, 'round_id' : RoundId, 'route' : Route }],
    ResultRecipient
  >,
  'update_public_profile' : ActorMethod<[ProfilePatch], ResultUser>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
