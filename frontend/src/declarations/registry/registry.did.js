export const idlFactory = ({ IDL }) => {
  const AssetId = IDL.Record({
    'decimals' : IDL.Nat8,
    'ledger' : IDL.Principal,
    'symbol' : IDL.Text,
  });
  const NetworkId = IDL.Variant({
    'icp' : IDL.Null,
    'polkadot' : IDL.Null,
    'solana' : IDL.Null,
    'other' : IDL.Text,
    'ethereum' : IDL.Null,
    'stellar' : IDL.Null,
    'bitcoin_cash' : IDL.Null,
    'cosmos' : IDL.Null,
    'bitcoin' : IDL.Null,
  });
  const Route = IDL.Record({
    'asset' : IDL.Opt(AssetId),
    'network' : NetworkId,
  });
  const PayoutAccountId = IDL.Nat64;
  const TimestampNs = IDL.Int;
  const UserId = IDL.Nat64;
  const VerificationState = IDL.Variant({
    'verified' : IDL.Null,
    'revoked' : IDL.Null,
    'pending' : IDL.Null,
    'legacy_imported' : IDL.Null,
  });
  const PayoutAccount = IDL.Record({
    'id' : PayoutAccountId,
    'active' : IDL.Bool,
    'created_at' : TimestampNs,
    'user_id' : UserId,
    'normalized_address' : IDL.Text,
    'default_for_route' : IDL.Bool,
    'address' : IDL.Text,
    'verified_at' : IDL.Opt(TimestampNs),
    'verification' : VerificationState,
    'route' : Route,
  });
  const AppError = IDL.Variant({
    'conflict' : IDL.Text,
    'expired' : IDL.Null,
    'internal' : IDL.Text,
    'invalid' : IDL.Text,
    'rate_limited' : IDL.Record({ 'retry_after_ns' : IDL.Nat64 }),
    'forbidden' : IDL.Null,
    'transient' : IDL.Text,
    'not_found' : IDL.Null,
    'unauthorized' : IDL.Null,
    'paused' : IDL.Null,
  });
  const Result_2 = IDL.Variant({ 'ok' : PayoutAccount, 'err' : AppError });
  const Result_15 = IDL.Variant({
    'ok' : IDL.Record({ 'user_id' : UserId, 'expires_at' : IDL.Int }),
    'err' : AppError,
  });
  const Result_12 = IDL.Variant({
    'ok' : IDL.Record({
      'message' : IDL.Text,
      'challenge_id' : IDL.Vec(IDL.Nat8),
      'expires_at' : IDL.Int,
    }),
    'err' : AppError,
  });
  const Result_13 = IDL.Variant({
    'ok' : IDL.Record({
      'login_url' : IDL.Text,
      'attempt_id' : IDL.Vec(IDL.Nat8),
      'expires_at' : IDL.Int,
    }),
    'err' : AppError,
  });
  const SessionIssuer = IDL.Variant({
    'oauth' : IDL.Text,
    'ethereum_wallet' : IDL.Null,
    'internet_identity' : IDL.Null,
  });
  const Session = IDL.Record({
    'issued_at' : TimestampNs,
    'user_id' : UserId,
    'revoked_at' : IDL.Opt(TimestampNs),
    'issuer' : SessionIssuer,
    'session_principal' : IDL.Principal,
    'expires_at' : TimestampNs,
  });
  const Result_10 = IDL.Variant({ 'ok' : Session, 'err' : AppError });
  const AttestationIssuer = IDL.Record({
    'public_key' : IDL.Vec(IDL.Nat8),
    'name' : IDL.Text,
    'caller' : IDL.Principal,
  });
  const OAuthProviderInput = IDL.Record({
    'kind' : IDL.Variant({
      'orcid' : IDL.Null,
      'bitbucket' : IDL.Null,
      'github' : IDL.Null,
      'gitlab' : IDL.Null,
    }),
    'client_id' : IDL.Text,
  });
  const UnitResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const AllocationId = IDL.Nat64;
  const RoundId = IDL.Nat64;
  const CarriedBalance = IDL.Record({
    'asset' : AssetId,
    'atoms' : IDL.Nat,
    'source_round' : RoundId,
    'reason' : IDL.Text,
  });
  const Result_11 = IDL.Variant({ 'ok' : CarriedBalance, 'err' : AppError });
  const Result_9 = IDL.Variant({
    'ok' : IDL.Vec(CarriedBalance),
    'err' : AppError,
  });
  const EligibilityStatus = IDL.Variant({
    'expired' : IDL.Null,
    'ineligible' : IDL.Null,
    'eligible' : IDL.Null,
    'unknown' : IDL.Null,
  });
  const Hash32 = IDL.Vec(IDL.Nat8);
  const EligibilityState = IDL.Record({
    'status' : EligibilityStatus,
    'reference_hash' : IDL.Opt(Hash32),
    'issuer' : IDL.Opt(IDL.Text),
    'expires_at' : IDL.Opt(TimestampNs),
  });
  const Result_3 = IDL.Variant({ 'ok' : EligibilityState, 'err' : AppError });
  const UserStatus = IDL.Variant({
    'deleted' : IDL.Null,
    'active' : IDL.Null,
    'banned' : TimestampNs,
  });
  const LegacyUserMapping = IDL.Record({
    'user_id' : UserId,
    'source_namespace' : IDL.Text,
    'legacy_user_id' : IDL.Text,
    'imported_profile' : IDL.Record({
      'status' : UserStatus,
      'name' : IDL.Opt(IDL.Text),
      'created_at' : TimestampNs,
    }),
  });
  const Result_7 = IDL.Variant({ 'ok' : LegacyUserMapping, 'err' : AppError });
  const PublicProfile = IDL.Record({
    'status' : UserStatus,
    'name' : IDL.Opt(IDL.Text),
    'created_at' : TimestampNs,
    'user_id' : UserId,
  });
  const Result_8 = IDL.Variant({ 'ok' : PublicProfile, 'err' : AppError });
  const HeaderField = IDL.Tuple(IDL.Text, IDL.Text);
  const HttpRequest = IDL.Record({
    'url' : IDL.Text,
    'method' : IDL.Text,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
    'certificate_version' : IDL.Opt(IDL.Nat16),
  });
  const StreamingCallbackResponse = IDL.Record({
    'token' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'body' : IDL.Vec(IDL.Nat8),
  });
  const StreamingStrategy = IDL.Variant({
    'Callback' : IDL.Record({
      'token' : IDL.Vec(IDL.Nat8),
      'callback' : IDL.Func(
          [IDL.Vec(IDL.Nat8)],
          [IDL.Opt(StreamingCallbackResponse)],
          ['query'],
        ),
    }),
  });
  const HttpResponse = IDL.Record({
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
    'upgrade' : IDL.Opt(IDL.Bool),
    'streaming_strategy' : IDL.Opt(StreamingStrategy),
    'status_code' : IDL.Nat16,
  });
  const HttpUpdateRequest = IDL.Record({
    'url' : IDL.Text,
    'method' : IDL.Text,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
  });
  const HttpUpdateResponse = IDL.Record({
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HeaderField),
    'streaming_strategy' : IDL.Opt(StreamingStrategy),
    'status_code' : IDL.Nat16,
  });
  const Result_6 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(LegacyUserMapping),
    }),
    'err' : AppError,
  });
  const Result_5 = IDL.Variant({
    'ok' : IDL.Vec(PayoutAccount),
    'err' : AppError,
  });
  const Result_4 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(PublicProfile),
    }),
    'err' : AppError,
  });
  const User = IDL.Record({
    'eligibility' : EligibilityState,
    'profile' : PublicProfile,
  });
  const Result = IDL.Variant({ 'ok' : User, 'err' : AppError });
  const HttpHeader = IDL.Record({ 'value' : IDL.Text, 'name' : IDL.Text });
  const HttpRequestResult = IDL.Record({
    'status' : IDL.Nat,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HttpHeader),
  });
  const TransformArg = IDL.Record({
    'context' : IDL.Vec(IDL.Nat8),
    'response' : HttpRequestResult,
  });
  const IcrcAccount = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const RecipientSnapshot = IDL.Record({
    'payout_account_id' : PayoutAccountId,
    'user_id' : UserId,
    'normalized_address' : IDL.Text,
    'icrc_account' : IDL.Opt(IcrcAccount),
    'captured_at' : TimestampNs,
    'route' : Route,
  });
  const Result_1 = IDL.Variant({ 'ok' : RecipientSnapshot, 'err' : AppError });
  return IDL.Service({
    'add_payout_account' : IDL.Func(
        [IDL.Record({ 'address' : IDL.Text, 'route' : Route })],
        [Result_2],
        [],
      ),
    'authorize_session' : IDL.Func([IDL.Principal], [Result_15], []),
    'begin_ethereum_login' : IDL.Func(
        [
          IDL.Record({
            'domain' : IDL.Text,
            'requested_action' : IDL.Text,
            'address' : IDL.Text,
            'session_principal' : IDL.Principal,
          }),
        ],
        [Result_12],
        [],
      ),
    'begin_oauth_login' : IDL.Func(
        [
          IDL.Record({
            'provider' : IDL.Text,
            'redirect_uri' : IDL.Text,
            'session_principal' : IDL.Principal,
          }),
        ],
        [Result_13],
        [],
      ),
    'begin_payout_proof' : IDL.Func([PayoutAccountId], [Result_12], []),
    'complete_ethereum_login' : IDL.Func(
        [
          IDL.Record({
            'signature' : IDL.Vec(IDL.Nat8),
            'public_key' : IDL.Vec(IDL.Nat8),
            'challenge_id' : IDL.Vec(IDL.Nat8),
          }),
        ],
        [Result_10],
        [],
      ),
    'complete_icrc_payout_proof' : IDL.Func([PayoutAccountId], [Result_2], []),
    'complete_internet_identity_login' : IDL.Func(
        [
          IDL.Record({
            'requested_action' : IDL.Text,
            'session_principal' : IDL.Principal,
          }),
        ],
        [Result_10],
        [],
      ),
    'complete_payout_proof' : IDL.Func(
        [PayoutAccountId, IDL.Vec(IDL.Nat8)],
        [Result_2],
        [],
      ),
    'configure_authorities' : IDL.Func(
        [
          IDL.Record({
            'attestation_issuers' : IDL.Vec(AttestationIssuer),
            'oauth_redirect_uris' : IDL.Vec(IDL.Text),
            'oauth_site_url' : IDL.Text,
            'allowed_actions' : IDL.Vec(IDL.Text),
            'oauth_providers' : IDL.Vec(OAuthProviderInput),
            'rounds_canister' : IDL.Opt(IDL.Principal),
            'session_consumers' : IDL.Vec(IDL.Principal),
            'allowed_domains' : IDL.Vec(IDL.Text),
          }),
        ],
        [UnitResult],
        [],
      ),
    'consume_carried_balance' : IDL.Func(
        [
          IDL.Record({
            'allocation_id' : AllocationId,
            'target_round' : RoundId,
          }),
        ],
        [Result_11],
        [],
      ),
    'credit_carried_balance' : IDL.Func(
        [
          IDL.Record({
            'balance' : CarriedBalance,
            'allocation_id' : AllocationId,
            'user_id' : UserId,
          }),
        ],
        [UnitResult],
        [],
      ),
    'current_session' : IDL.Func([], [Result_10], ['query']),
    'get_carried_balances' : IDL.Func([UserId], [Result_9], ['query']),
    'get_eligibility' : IDL.Func([UserId], [Result_3], ['query']),
    'get_legacy_user_mapping' : IDL.Func(
        [IDL.Text, IDL.Text],
        [Result_7],
        ['query'],
      ),
    'get_public_profile' : IDL.Func([UserId], [Result_8], ['query']),
    'http_request' : IDL.Func([HttpRequest], [HttpResponse], ['query']),
    'http_request_update' : IDL.Func(
        [HttpUpdateRequest],
        [HttpUpdateResponse],
        [],
      ),
    'import_legacy_payout_account' : IDL.Func(
        [UserId, IDL.Record({ 'address' : IDL.Text, 'route' : Route })],
        [Result_2],
        [],
      ),
    'import_legacy_profile' : IDL.Func(
        [
          IDL.Record({
            'status' : UserStatus,
            'name' : IDL.Opt(IDL.Text),
            'created_at' : IDL.Int,
            'source_namespace' : IDL.Text,
            'legacy_user_id' : IDL.Text,
          }),
        ],
        [Result_7],
        [],
      ),
    'interface_version' : IDL.Func(
        [],
        [
          IDL.Record({
            'major' : IDL.Nat16,
            'minor' : IDL.Nat16,
            'patch' : IDL.Nat16,
            'schema_hash' : IDL.Vec(IDL.Nat8),
          }),
        ],
        ['query'],
      ),
    'list_legacy_user_mappings' : IDL.Func(
        [
          IDL.Record({
            'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
            'limit' : IDL.Nat32,
          }),
        ],
        [Result_6],
        ['query'],
      ),
    'list_my_payout_accounts' : IDL.Func([], [Result_5], ['query']),
    'list_public_profiles' : IDL.Func(
        [
          IDL.Record({
            'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
            'limit' : IDL.Nat32,
          }),
        ],
        [Result_4],
        ['query'],
      ),
    'me' : IDL.Func([], [Result], ['query']),
    'oauthTransform' : IDL.Func([TransformArg], [HttpRequestResult], ['query']),
    'put_attestation' : IDL.Func(
        [
          IDL.Record({
            'status' : IDL.Variant({
              'ineligible' : IDL.Null,
              'eligible' : IDL.Null,
            }),
            'signature' : IDL.Vec(IDL.Nat8),
            'issued_at' : IDL.Int,
            'reference_hash' : IDL.Vec(IDL.Nat8),
            'user_id' : UserId,
            'issuer' : IDL.Text,
            'expires_at' : IDL.Opt(IDL.Int),
          }),
        ],
        [Result_3],
        [],
      ),
    'revoke_all_sessions' : IDL.Func([], [UnitResult], []),
    'revoke_payout_account' : IDL.Func([PayoutAccountId], [Result_2], []),
    'revoke_session' : IDL.Func([IDL.Principal], [UnitResult], []),
    'set_default_payout_account' : IDL.Func([PayoutAccountId], [Result_2], []),
    'set_payout_account_active' : IDL.Func(
        [PayoutAccountId, IDL.Bool],
        [Result_2],
        [],
      ),
    'snapshot_recipient' : IDL.Func(
        [
          IDL.Record({
            'user_id' : UserId,
            'round_id' : RoundId,
            'route' : Route,
          }),
        ],
        [Result_1],
        [],
      ),
    'update_public_profile' : IDL.Func(
        [IDL.Record({ 'name' : IDL.Opt(IDL.Text) })],
        [Result],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
