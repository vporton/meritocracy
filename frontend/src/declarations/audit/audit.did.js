export const idlFactory = ({ IDL }) => {
  const UserId = IDL.Nat64;
  const RoundId = IDL.Nat64;
  const AuditSubject = IDL.Variant({
    'evaluation' : IDL.Nat64,
    'user' : UserId,
    'allocation' : IDL.Nat64,
    'round' : RoundId,
    'system' : IDL.Text,
  });
  const AuditKind = IDL.Variant({
    'evaluation' : IDL.Null,
    'attestation' : IDL.Null,
    'session' : IDL.Null,
    'dispute' : IDL.Null,
    'governance' : IDL.Null,
    'reconciliation' : IDL.Null,
    'transfer' : IDL.Null,
    'round' : IDL.Null,
    'profile' : IDL.Null,
  });
  const TimestampNs = IDL.Int;
  const Hash32 = IDL.Vec(IDL.Nat8);
  const AuditEvent = IDL.Record({
    'actor' : IDL.Principal,
    'subject' : AuditSubject,
    'public_payload' : IDL.Vec(IDL.Nat8),
    'kind' : AuditKind,
    'occurred_at' : TimestampNs,
    'event_id' : Hash32,
    'payload_hash' : Hash32,
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
  const Result_3 = IDL.Variant({ 'ok' : AuditEvent, 'err' : AppError });
  const UnitResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const AuditPage = IDL.Record({
    'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'items' : IDL.Vec(AuditEvent),
  });
  const Result_2 = IDL.Variant({ 'ok' : AuditPage, 'err' : AppError });
  const RoundReport = IDL.Record({
    'last_event_at' : IDL.Opt(TimestampNs),
    'event_count' : IDL.Nat64,
    'round_id' : RoundId,
    'event_root' : Hash32,
  });
  const Result_1 = IDL.Variant({ 'ok' : RoundReport, 'err' : AppError });
  const UserReport = IDL.Record({ 'user_id' : UserId, 'events' : AuditPage });
  const Result = IDL.Variant({ 'ok' : UserReport, 'err' : AppError });
  return IDL.Service({
    'append' : IDL.Func([AuditEvent], [Result_3], []),
    'configure_authorities' : IDL.Func(
        [IDL.Record({ 'appenders' : IDL.Vec(IDL.Principal) })],
        [UnitResult],
        [],
      ),
    'get_event' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result_3], ['query']),
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
    'list_events' : IDL.Func(
        [
          IDL.Record({
            'to' : IDL.Opt(TimestampNs),
            'subject' : IDL.Opt(AuditSubject),
            'from' : IDL.Opt(TimestampNs),
            'kind' : IDL.Opt(AuditKind),
            'page' : IDL.Record({
              'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
              'limit' : IDL.Nat32,
            }),
          }),
        ],
        [Result_2],
        ['query'],
      ),
    'report_round' : IDL.Func([RoundId], [Result_1], ['query']),
    'report_user' : IDL.Func(
        [
          UserId,
          IDL.Record({
            'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
            'limit' : IDL.Nat32,
          }),
        ],
        [Result],
        ['query'],
      ),
    'storage_stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'public_payload_bytes' : IDL.Nat64,
            'events' : IDL.Nat64,
          }),
        ],
        ['query'],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
