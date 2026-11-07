import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export type AllocationId = bigint;
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
export interface AttestationIssuer {
  'public_key' : Uint8Array | number[],
  'name' : string,
  'caller' : Principal,
}
export interface CarriedBalance {
  'asset' : AssetId,
  'atoms' : bigint,
  'source_round' : RoundId,
  'reason' : string,
}
export interface EligibilityState {
  'status' : EligibilityStatus,
  'reference_hash' : [] | [Hash32],
  'issuer' : [] | [string],
  'expires_at' : [] | [TimestampNs],
}
export type EligibilityStatus = { 'expired' : null } |
  { 'ineligible' : null } |
  { 'eligible' : null } |
  { 'unknown' : null };
export type Hash32 = Uint8Array | number[];
export type HeaderField = [string, string];
export interface HttpHeader { 'value' : string, 'name' : string }
export interface HttpRequest {
  'url' : string,
  'method' : string,
  'body' : Uint8Array | number[],
  'headers' : Array<HeaderField>,
  'certificate_version' : [] | [number],
}
export interface HttpRequestResult {
  'status' : bigint,
  'body' : Uint8Array | number[],
  'headers' : Array<HttpHeader>,
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
export interface IcrcAccount {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export interface LegacyUserMapping {
  'user_id' : UserId,
  'source_namespace' : string,
  'legacy_user_id' : string,
  'imported_profile' : {
    'status' : UserStatus,
    'name' : [] | [string],
    'created_at' : TimestampNs,
  },
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
export interface OAuthProviderInput {
  'kind' : { 'orcid' : null } |
    { 'bitbucket' : null } |
    { 'github' : null } |
    { 'gitlab' : null },
  'client_id' : string,
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
  'verification' : VerificationState,
  'route' : Route,
}
export type PayoutAccountId = bigint;
export interface PublicProfile {
  'status' : UserStatus,
  'name' : [] | [string],
  'created_at' : TimestampNs,
  'user_id' : UserId,
}
export interface RecipientSnapshot {
  'payout_account_id' : PayoutAccountId,
  'user_id' : UserId,
  'normalized_address' : string,
  'icrc_account' : [] | [IcrcAccount],
  'captured_at' : TimestampNs,
  'route' : Route,
}
export type Result = { 'ok' : User } |
  { 'err' : AppError };
export type Result_1 = { 'ok' : RecipientSnapshot } |
  { 'err' : AppError };
export type Result_10 = { 'ok' : Session } |
  { 'err' : AppError };
export type Result_11 = { 'ok' : CarriedBalance } |
  { 'err' : AppError };
export type Result_12 = {
    'ok' : {
      'message' : string,
      'challenge_id' : Uint8Array | number[],
      'expires_at' : bigint,
    }
  } |
  { 'err' : AppError };
export type Result_13 = {
    'ok' : {
      'login_url' : string,
      'attempt_id' : Uint8Array | number[],
      'expires_at' : bigint,
    }
  } |
  { 'err' : AppError };
export type Result_15 = {
    'ok' : { 'user_id' : UserId, 'expires_at' : bigint }
  } |
  { 'err' : AppError };
export type Result_2 = { 'ok' : PayoutAccount } |
  { 'err' : AppError };
export type Result_3 = { 'ok' : EligibilityState } |
  { 'err' : AppError };
export type Result_4 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<PublicProfile>,
    }
  } |
  { 'err' : AppError };
export type Result_5 = { 'ok' : Array<PayoutAccount> } |
  { 'err' : AppError };
export type Result_6 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<LegacyUserMapping>,
    }
  } |
  { 'err' : AppError };
export type Result_7 = { 'ok' : LegacyUserMapping } |
  { 'err' : AppError };
export type Result_8 = { 'ok' : PublicProfile } |
  { 'err' : AppError };
export type Result_9 = { 'ok' : Array<CarriedBalance> } |
  { 'err' : AppError };
export type RoundId = bigint;
export interface Route { 'asset' : [] | [AssetId], 'network' : NetworkId }
export interface Session {
  'issued_at' : TimestampNs,
  'user_id' : UserId,
  'revoked_at' : [] | [TimestampNs],
  'issuer' : SessionIssuer,
  'session_principal' : Principal,
  'expires_at' : TimestampNs,
}
export type SessionIssuer = { 'oauth' : string } |
  { 'ethereum_wallet' : null } |
  { 'internet_identity' : null };
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
export interface TransformArg {
  'context' : Uint8Array | number[],
  'response' : HttpRequestResult,
}
export type UnitResult = { 'ok' : null } |
  { 'err' : AppError };
export interface User {
  'eligibility' : EligibilityState,
  'profile' : PublicProfile,
}
export type UserId = bigint;
export type UserStatus = { 'deleted' : null } |
  { 'active' : null } |
  { 'banned' : TimestampNs };
export type VerificationState = { 'verified' : null } |
  { 'revoked' : null } |
  { 'pending' : null } |
  { 'legacy_imported' : null };
export interface _SERVICE {
  'add_payout_account' : ActorMethod<
    [{ 'address' : string, 'route' : Route }],
    Result_2
  >,
  'authorize_session' : ActorMethod<[Principal], Result_15>,
  'begin_ethereum_login' : ActorMethod<
    [
      {
        'domain' : string,
        'requested_action' : string,
        'address' : string,
        'session_principal' : Principal,
      },
    ],
    Result_12
  >,
  'begin_oauth_login' : ActorMethod<
    [
      {
        'provider' : string,
        'redirect_uri' : string,
        'session_principal' : Principal,
      },
    ],
    Result_13
  >,
  'begin_payout_proof' : ActorMethod<[PayoutAccountId], Result_12>,
  'complete_ethereum_login' : ActorMethod<
    [
      {
        'signature' : Uint8Array | number[],
        'public_key' : Uint8Array | number[],
        'challenge_id' : Uint8Array | number[],
      },
    ],
    Result_10
  >,
  'complete_icrc_payout_proof' : ActorMethod<[PayoutAccountId], Result_2>,
  'complete_internet_identity_login' : ActorMethod<
    [{ 'requested_action' : string, 'session_principal' : Principal }],
    Result_10
  >,
  'complete_payout_proof' : ActorMethod<
    [PayoutAccountId, Uint8Array | number[]],
    Result_2
  >,
  'configure_authorities' : ActorMethod<
    [
      {
        'attestation_issuers' : Array<AttestationIssuer>,
        'oauth_redirect_uris' : Array<string>,
        'oauth_site_url' : string,
        'allowed_actions' : Array<string>,
        'oauth_providers' : Array<OAuthProviderInput>,
        'rounds_canister' : [] | [Principal],
        'session_consumers' : Array<Principal>,
        'allowed_domains' : Array<string>,
      },
    ],
    UnitResult
  >,
  'consume_carried_balance' : ActorMethod<
    [{ 'allocation_id' : AllocationId, 'target_round' : RoundId }],
    Result_11
  >,
  'credit_carried_balance' : ActorMethod<
    [
      {
        'balance' : CarriedBalance,
        'allocation_id' : AllocationId,
        'user_id' : UserId,
      },
    ],
    UnitResult
  >,
  'current_session' : ActorMethod<[], Result_10>,
  'get_carried_balances' : ActorMethod<[UserId], Result_9>,
  'get_eligibility' : ActorMethod<[UserId], Result_3>,
  'get_legacy_user_mapping' : ActorMethod<[string, string], Result_7>,
  'get_public_profile' : ActorMethod<[UserId], Result_8>,
  'http_request' : ActorMethod<[HttpRequest], HttpResponse>,
  'http_request_update' : ActorMethod<[HttpUpdateRequest], HttpUpdateResponse>,
  'import_legacy_payout_account' : ActorMethod<
    [UserId, { 'address' : string, 'route' : Route }],
    Result_2
  >,
  'import_legacy_profile' : ActorMethod<
    [
      {
        'status' : UserStatus,
        'name' : [] | [string],
        'created_at' : bigint,
        'source_namespace' : string,
        'legacy_user_id' : string,
      },
    ],
    Result_7
  >,
  'interface_version' : ActorMethod<
    [],
    {
      'major' : number,
      'minor' : number,
      'patch' : number,
      'schema_hash' : Uint8Array | number[],
    }
  >,
  'list_legacy_user_mappings' : ActorMethod<
    [{ 'cursor' : [] | [Uint8Array | number[]], 'limit' : number }],
    Result_6
  >,
  'list_my_payout_accounts' : ActorMethod<[], Result_5>,
  'list_public_profiles' : ActorMethod<
    [{ 'cursor' : [] | [Uint8Array | number[]], 'limit' : number }],
    Result_4
  >,
  'me' : ActorMethod<[], Result>,
  'oauthTransform' : ActorMethod<[TransformArg], HttpRequestResult>,
  'put_attestation' : ActorMethod<
    [
      {
        'status' : { 'ineligible' : null } |
          { 'eligible' : null },
        'signature' : Uint8Array | number[],
        'issued_at' : bigint,
        'reference_hash' : Uint8Array | number[],
        'user_id' : UserId,
        'issuer' : string,
        'expires_at' : [] | [bigint],
      },
    ],
    Result_3
  >,
  'revoke_all_sessions' : ActorMethod<[], UnitResult>,
  'revoke_payout_account' : ActorMethod<[PayoutAccountId], Result_2>,
  'revoke_session' : ActorMethod<[Principal], UnitResult>,
  'set_default_payout_account' : ActorMethod<[PayoutAccountId], Result_2>,
  'set_payout_account_active' : ActorMethod<
    [PayoutAccountId, boolean],
    Result_2
  >,
  'snapshot_recipient' : ActorMethod<
    [{ 'user_id' : UserId, 'round_id' : RoundId, 'route' : Route }],
    Result_1
  >,
  'update_public_profile' : ActorMethod<[{ 'name' : [] | [string] }], Result>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
