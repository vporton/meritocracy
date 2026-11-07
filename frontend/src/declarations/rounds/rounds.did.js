export const idlFactory = ({ IDL }) => {
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
  const UnitResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const AssetId = IDL.Record({
    'decimals' : IDL.Nat8,
    'ledger' : IDL.Principal,
    'symbol' : IDL.Text,
  });
  const RoundId = IDL.Nat64;
  const RoundStatus = IDL.Variant({
    'funded' : IDL.Null,
    'complete' : IDL.Null,
    'executing' : IDL.Null,
    'draft' : IDL.Null,
    'paused' : IDL.Null,
    'disputing' : IDL.Null,
  });
  const Hash32 = IDL.Vec(IDL.Nat8);
  const TimestampNs = IDL.Int;
  const Round = IDL.Record({
    'id' : RoundId,
    'status' : RoundStatus,
    'asset' : AssetId,
    'reserved_atoms' : IDL.Nat,
    'source_fund' : Hash32,
    'vault_subaccount' : IDL.Vec(IDL.Nat8),
    'required_atoms' : IDL.Nat,
    'dispute_ends_at' : IDL.Opt(TimestampNs),
    'allocation_version' : IDL.Opt(Hash32),
  });
  const Result = IDL.Variant({ 'ok' : Round, 'err' : AppError });
  const ExecutionSummary = IDL.Record({
    'sent' : IDL.Nat32,
    'prepared' : IDL.Nat32,
    'carried' : IDL.Nat32,
    'retryable' : IDL.Nat32,
  });
  const Result_2 = IDL.Variant({ 'ok' : ExecutionSummary, 'err' : AppError });
  const AllocationId = IDL.Nat64;
  const DisputeState = IDL.Variant({
    'open' : IDL.Null,
    'upheld' : IDL.Null,
    'rejected' : IDL.Null,
  });
  const Dispute = IDL.Record({
    'id' : IDL.Nat64,
    'evidence_hash' : Hash32,
    'allocation_id' : AllocationId,
    'created_at' : TimestampNs,
    'state' : DisputeState,
    'reason_code' : IDL.Text,
    'round_id' : RoundId,
  });
  const Result_3 = IDL.Variant({ 'ok' : Dispute, 'err' : AppError });
  const Page = IDL.Record({
    'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'limit' : IDL.Nat32,
  });
  const AllocationState = IDL.Variant({
    'pending' : IDL.Null,
    'paid' : IDL.Nat,
    'frozen' : IDL.Null,
    'carried' : IDL.Text,
  });
  const UserId = IDL.Nat64;
  const AllocationDraft = IDL.Record({
    'id' : AllocationId,
    'evidence_hash' : Hash32,
    'amount_atoms' : IDL.Nat,
    'user_id' : UserId,
  });
  const Allocation = IDL.Record({
    'state' : AllocationState,
    'draft' : AllocationDraft,
    'recipient_hash' : IDL.Opt(Hash32),
  });
  const Result_8 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(Allocation),
    }),
    'err' : AppError,
  });
  const Result_7 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(Dispute),
    }),
    'err' : AppError,
  });
  const Result_6 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(Round),
    }),
    'err' : AppError,
  });
  const Result_5 = IDL.Variant({ 'ok' : IDL.Vec(IDL.Nat8), 'err' : AppError });
  const Reconciliation = IDL.Record({
    'reconciled' : IDL.Bool,
    'reserved_atoms' : IDL.Nat,
    'deficit_atoms' : IDL.Nat,
    'excess_atoms' : IDL.Nat,
    'ledger_atoms' : IDL.Nat,
    'round_id' : RoundId,
    'checked_at' : TimestampNs,
  });
  const Result_4 = IDL.Variant({ 'ok' : Reconciliation, 'err' : AppError });
  const DisputeResolution = IDL.Variant({
    'reject' : IDL.Null,
    'uphold' : IDL.Null,
  });
  const Result_1 = IDL.Variant({ 'ok' : Allocation, 'err' : AppError });
  return IDL.Service({
    'configure_authorities' : IDL.Func(
        [
          IDL.Record({
            'audit_canister' : IDL.Principal,
            'managers' : IDL.Vec(IDL.Principal),
            'vault_canister' : IDL.Principal,
            'dispute_resolvers' : IDL.Vec(IDL.Principal),
            'registry_canister' : IDL.Principal,
          }),
        ],
        [UnitResult],
        [],
      ),
    'create_draft' : IDL.Func(
        [
          IDL.Record({
            'asset' : AssetId,
            'source_fund' : IDL.Vec(IDL.Nat8),
            'required_atoms' : IDL.Nat,
          }),
        ],
        [Result],
        [],
      ),
    'execute_due' : IDL.Func([RoundId], [Result_2], []),
    'file_dispute' : IDL.Func(
        [
          IDL.Record({
            'evidence_hash' : IDL.Vec(IDL.Nat8),
            'allocation_id' : AllocationId,
            'reason_code' : IDL.Text,
            'round_id' : RoundId,
          }),
        ],
        [Result_3],
        [],
      ),
    'finalize' : IDL.Func([RoundId], [Result], []),
    'get_dispute' : IDL.Func([IDL.Nat64], [Result_3], ['query']),
    'get_round' : IDL.Func([RoundId], [Result], ['query']),
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
    'list_allocations' : IDL.Func([RoundId, Page], [Result_8], ['query']),
    'list_disputes' : IDL.Func(
        [
          IDL.Record({
            'page' : Page,
            'state' : IDL.Opt(DisputeState),
            'round_id' : IDL.Opt(RoundId),
          }),
        ],
        [Result_7],
        ['query'],
      ),
    'list_rounds' : IDL.Func(
        [IDL.Record({ 'status' : IDL.Opt(RoundStatus), 'page' : Page })],
        [Result_6],
        ['query'],
      ),
    'put_allocation_version' : IDL.Func(
        [
          IDL.Record({
            'expected_previous_version' : IDL.Opt(IDL.Vec(IDL.Nat8)),
            'allocations' : IDL.Vec(AllocationDraft),
            'round_id' : RoundId,
          }),
        ],
        [Result_5],
        [],
      ),
    'reconcile' : IDL.Func([RoundId], [Result_4], []),
    'resolve_dispute' : IDL.Func(
        [
          IDL.Record({
            'dispute_id' : IDL.Nat64,
            'resolution' : DisputeResolution,
          }),
        ],
        [Result_3],
        [],
      ),
    'retry_execution' : IDL.Func([RoundId], [Result_2], []),
    'rollover_carried' : IDL.Func(
        [
          IDL.Record({
            'source_allocation_id' : AllocationId,
            'target_round' : RoundId,
            'target_allocation_id' : AllocationId,
          }),
        ],
        [UnitResult],
        [],
      ),
    'settle_frozen_to_carried' : IDL.Func(
        [IDL.Record({ 'dispute_id' : IDL.Nat64, 'reason' : IDL.Text })],
        [Result_1],
        [],
      ),
    'verify_funding' : IDL.Func([RoundId], [Result], []),
  });
};
export const init = ({ IDL }) => { return []; };
