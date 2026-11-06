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
  const PayoutAccountInput = IDL.Record({
    'address' : IDL.Text,
    'route' : Route,
  });
  const PayoutAccountId = IDL.Nat64;
  const TimestampNs = IDL.Int;
  const UserId = IDL.Nat64;
  const PayoutAccount = IDL.Record({
    'id' : PayoutAccountId,
    'active' : IDL.Bool,
    'created_at' : TimestampNs,
    'user_id' : UserId,
    'normalized_address' : IDL.Text,
    'default_for_route' : IDL.Bool,
    'address' : IDL.Text,
    'verified_at' : IDL.Opt(TimestampNs),
    'verification' : IDL.Variant({
      'verified' : IDL.Null,
      'revoked' : IDL.Null,
      'pending' : IDL.Null,
      'legacy_imported' : IDL.Null,
    }),
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
  const ResultAccount = IDL.Variant({ 'ok' : PayoutAccount, 'err' : AppError });
  const ResultAuthorization = IDL.Variant({
    'ok' : IDL.Record({ 'user_id' : UserId, 'expires_at' : TimestampNs }),
    'err' : AppError,
  });
  const AuthorityConfig = IDL.Record({
    'rounds_canister' : IDL.Opt(IDL.Principal),
    'session_consumers' : IDL.Vec(IDL.Principal),
    'attestation_issuers' : IDL.Vec(IDL.Record({
      'name' : IDL.Text,
      'caller' : IDL.Principal,
      'public_key' : IDL.Vec(IDL.Nat8),
    })),
    'allowed_domains' : IDL.Vec(IDL.Text),
    'allowed_actions' : IDL.Vec(IDL.Text),
  });
  const Challenge = IDL.Record({
    'message' : IDL.Text,
    'challenge_id' : IDL.Vec(IDL.Nat8),
    'expires_at' : TimestampNs,
  });
  const ResultChallenge = IDL.Variant({ 'ok' : Challenge, 'err' : AppError });
  const OAuthStart = IDL.Record({
    'login_url' : IDL.Text,
    'attempt_id' : IDL.Vec(IDL.Nat8),
    'expires_at' : TimestampNs,
  });
  const ResultOAuth = IDL.Variant({ 'ok' : OAuthStart, 'err' : AppError });
  const Session = IDL.Record({
    'issued_at' : TimestampNs,
    'user_id' : UserId,
    'revoked_at' : IDL.Opt(TimestampNs),
    'issuer' : IDL.Variant({
      'oauth' : IDL.Text,
      'ethereum_wallet' : IDL.Null,
      'internet_identity' : IDL.Null,
    }),
    'session_principal' : IDL.Principal,
    'expires_at' : TimestampNs,
  });
  const ResultSession = IDL.Variant({ 'ok' : Session, 'err' : AppError });
  const RoundId = IDL.Nat64;
  const CarriedBalance = IDL.Record({
    'asset' : AssetId,
    'atoms' : IDL.Nat,
    'source_round' : RoundId,
    'reason' : IDL.Text,
  });
  const ResultUnit = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const ResultBalances = IDL.Variant({
    'ok' : IDL.Vec(CarriedBalance),
    'err' : AppError,
  });
  const Hash32 = IDL.Vec(IDL.Nat8);
  const EligibilityState = IDL.Record({
    'status' : IDL.Variant({
      'expired' : IDL.Null,
      'ineligible' : IDL.Null,
      'eligible' : IDL.Null,
      'unknown' : IDL.Null,
    }),
    'reference_hash' : IDL.Opt(Hash32),
    'issuer' : IDL.Opt(IDL.Text),
    'expires_at' : IDL.Opt(TimestampNs),
  });
  const ResultEligibility = IDL.Variant({
    'ok' : EligibilityState,
    'err' : AppError,
  });
  const PublicProfile = IDL.Record({
    'status' : IDL.Variant({
      'deleted' : IDL.Null,
      'active' : IDL.Null,
      'banned' : TimestampNs,
    }),
    'name' : IDL.Opt(IDL.Text),
    'created_at' : TimestampNs,
    'user_id' : UserId,
  });
  const ResultProfile = IDL.Variant({ 'ok' : PublicProfile, 'err' : AppError });
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
  const InterfaceVersion = IDL.Record({
    'major' : IDL.Nat16,
    'minor' : IDL.Nat16,
    'patch' : IDL.Nat16,
    'schema_hash' : Hash32,
  });
  const ResultAccounts = IDL.Variant({
    'ok' : IDL.Vec(PayoutAccount),
    'err' : AppError,
  });
  const Page = IDL.Record({
    'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'limit' : IDL.Nat32,
  });
  const ProfilePage = IDL.Record({
    'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'items' : IDL.Vec(PublicProfile),
  });
  const ResultProfiles = IDL.Variant({ 'ok' : ProfilePage, 'err' : AppError });
  const User = IDL.Record({
    'eligibility' : EligibilityState,
    'profile' : PublicProfile,
  });
  const ResultUser = IDL.Variant({ 'ok' : User, 'err' : AppError });
  const SignedAttestation = IDL.Record({
    'status' : IDL.Variant({ 'ineligible' : IDL.Null, 'eligible' : IDL.Null }),
    'signature' : IDL.Vec(IDL.Nat8),
    'issued_at' : TimestampNs,
    'reference_hash' : Hash32,
    'user_id' : UserId,
    'issuer' : IDL.Text,
    'expires_at' : IDL.Opt(TimestampNs),
  });
  const RecipientSnapshot = IDL.Record({
    'payout_account_id' : PayoutAccountId,
    'user_id' : UserId,
    'normalized_address' : IDL.Text,
    'captured_at' : TimestampNs,
    'route' : Route,
  });
  const ResultRecipient = IDL.Variant({
    'ok' : RecipientSnapshot,
    'err' : AppError,
  });
  const ProfilePatch = IDL.Record({ 'name' : IDL.Opt(IDL.Text) });
  return IDL.Service({
    'add_payout_account' : IDL.Func([PayoutAccountInput], [ResultAccount], []),
    'authorize_session' : IDL.Func(
        [IDL.Principal],
        [ResultAuthorization],
        [],
      ),
    'configure_authorities' : IDL.Func([AuthorityConfig], [ResultUnit], []),
    'begin_ethereum_login' : IDL.Func(
        [
          IDL.Record({
            'domain' : IDL.Text,
            'requested_action' : IDL.Text,
            'address' : IDL.Text,
            'session_principal' : IDL.Principal,
          }),
        ],
        [ResultChallenge],
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
        [ResultOAuth],
        [],
      ),
    'begin_payout_proof' : IDL.Func([PayoutAccountId], [ResultChallenge], []),
    'complete_ethereum_login' : IDL.Func(
        [
          IDL.Record({
            'signature' : IDL.Vec(IDL.Nat8),
            'public_key' : IDL.Vec(IDL.Nat8),
            'challenge_id' : IDL.Vec(IDL.Nat8),
          }),
        ],
        [ResultSession],
        [],
      ),
    'complete_internet_identity_login' : IDL.Func(
        [
          IDL.Record({
            'requested_action' : IDL.Text,
            'session_principal' : IDL.Principal,
          }),
        ],
        [ResultSession],
        [],
      ),
    'complete_payout_proof' : IDL.Func(
        [PayoutAccountId, IDL.Vec(IDL.Nat8)],
        [ResultAccount],
        [],
      ),
    'credit_carried_balance' : IDL.Func(
        [
          IDL.Record({
            'balance' : CarriedBalance,
            'allocation_id' : IDL.Nat64,
            'user_id' : UserId,
          }),
        ],
        [ResultUnit],
        [],
      ),
    'get_carried_balances' : IDL.Func([UserId], [ResultBalances], ['query']),
    'get_eligibility' : IDL.Func([UserId], [ResultEligibility], ['query']),
    'get_public_profile' : IDL.Func([UserId], [ResultProfile], ['query']),
    'http_request' : IDL.Func([HttpRequest], [HttpResponse], ['query']),
    'http_request_update' : IDL.Func(
        [HttpUpdateRequest],
        [HttpUpdateResponse],
        [],
      ),
    'import_legacy_payout_account' : IDL.Func(
        [UserId, PayoutAccountInput],
        [ResultAccount],
        [],
      ),
    'interface_version' : IDL.Func([], [InterfaceVersion], ['query']),
    'list_my_payout_accounts' : IDL.Func([], [ResultAccounts], ['query']),
    'list_public_profiles' : IDL.Func([Page], [ResultProfiles], ['query']),
    'me' : IDL.Func([], [ResultUser], ['query']),
    'put_attestation' : IDL.Func([SignedAttestation], [ResultEligibility], []),
    'revoke_all_sessions' : IDL.Func([], [ResultUnit], []),
    'revoke_payout_account' : IDL.Func([PayoutAccountId], [ResultAccount], []),
    'revoke_session' : IDL.Func([IDL.Principal], [ResultUnit], []),
    'set_default_payout_account' : IDL.Func(
        [PayoutAccountId],
        [ResultAccount],
        [],
      ),
    'set_payout_account_active' : IDL.Func(
        [PayoutAccountId, IDL.Bool],
        [ResultAccount],
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
        [ResultRecipient],
        [],
      ),
    'update_public_profile' : IDL.Func([ProfilePatch], [ResultUser], []),
  });
};
export const init = ({ IDL }) => { return []; };
