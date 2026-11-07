export const idlFactory = ({ IDL }) => {
  const RoundId = IDL.Nat64;
  const AssetId = IDL.Record({
    'decimals' : IDL.Nat8,
    'ledger' : IDL.Principal,
    'symbol' : IDL.Text,
  });
  const Hash32 = IDL.Vec(IDL.Nat8);
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Reservation = IDL.Record({
    'asset' : AssetId,
    'fund' : Hash32,
    'finalized_outstanding_atoms' : IDL.Opt(IDL.Nat),
    'transfer_count' : IDL.Nat32,
    'reserved_atoms' : IDL.Nat,
    'fee_budget_atoms' : IDL.Nat,
    'finalized_outstanding_count' : IDL.Opt(IDL.Nat32),
    'account' : Account,
    'round_id' : RoundId,
    'required_atoms' : IDL.Nat,
    'allocation_version' : Hash32,
    'accounting_deficit_atoms' : IDL.Nat,
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
  const Result_1 = IDL.Variant({ 'ok' : Reservation, 'err' : AppError });
  const UnitResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const AllocationId = IDL.Nat64;
  const PreparedTransfer = IDL.Record({
    'to' : Account,
    'amount_atoms' : IDL.Nat,
    'allocation_id' : AllocationId,
    'memo' : Hash32,
    'created_at_time' : IDL.Nat64,
  });
  const TransferState = IDL.Variant({
    'permanent_failure' : IDL.Text,
    'sent' : IDL.Nat,
    'prepared' : IDL.Null,
    'executing' : IDL.Nat32,
    'retryable_failure' : IDL.Text,
  });
  const Transfer = IDL.Record({
    'to' : Account,
    'amount_atoms' : IDL.Nat,
    'fee_atoms' : IDL.Opt(IDL.Nat),
    'allocation_id' : AllocationId,
    'memo' : Hash32,
    'state' : TransferState,
    'created_at_time' : IDL.Nat64,
  });
  const BatchExecution = IDL.Record({
    'transfers' : IDL.Vec(Transfer),
    'round_id' : RoundId,
  });
  const Result_5 = IDL.Variant({ 'ok' : BatchExecution, 'err' : AppError });
  const RolloverState = IDL.Variant({
    'permanent_failure' : IDL.Text,
    'sent' : IDL.Nat,
    'prepared' : IDL.Null,
    'retryable_failure' : IDL.Text,
  });
  const Rollover = IDL.Record({
    'to' : Account,
    'amount_atoms' : IDL.Nat,
    'fee_atoms' : IDL.Nat,
    'allocation_id' : AllocationId,
    'memo' : Hash32,
    'target_round' : RoundId,
    'state' : RolloverState,
    'source_round' : RoundId,
    'created_at_time' : IDL.Nat64,
  });
  const Result = IDL.Variant({ 'ok' : Rollover, 'err' : AppError });
  const TimestampNs = IDL.Int;
  const Result_4 = IDL.Variant({
    'ok' : IDL.Record({ 'atoms' : IDL.Nat, 'checked_at' : TimestampNs }),
    'err' : AppError,
  });
  const Result_3 = IDL.Variant({ 'ok' : Transfer, 'err' : AppError });
  const Reconciliation = IDL.Record({
    'reconciled' : IDL.Bool,
    'reserved_atoms' : IDL.Nat,
    'deficit_atoms' : IDL.Nat,
    'excess_atoms' : IDL.Nat,
    'ledger_atoms' : IDL.Nat,
    'round_id' : RoundId,
    'checked_at' : TimestampNs,
  });
  const Result_2 = IDL.Variant({ 'ok' : Reconciliation, 'err' : AppError });
  return IDL.Service({
    'close_round' : IDL.Func(
        [
          IDL.Record({
            'outstanding_atoms' : IDL.Nat,
            'round_id' : RoundId,
            'outstanding_count' : IDL.Nat32,
          }),
        ],
        [Result_1],
        [],
      ),
    'configure_authorities' : IDL.Func(
        [
          IDL.Record({
            'supported_ledgers' : IDL.Vec(IDL.Principal),
            'rounds_canister' : IDL.Principal,
          }),
        ],
        [UnitResult],
        [],
      ),
    'derive_round_account' : IDL.Func(
        [
          IDL.Record({
            'asset' : AssetId,
            'fund' : Hash32,
            'round_id' : RoundId,
          }),
        ],
        [Account],
        ['query'],
      ),
    'emergency_pause_status' : IDL.Func([], [IDL.Bool], ['query']),
    'execute_batch' : IDL.Func(
        [
          IDL.Record({
            'transfers' : IDL.Vec(PreparedTransfer),
            'round_id' : RoundId,
            'allocation_version' : Hash32,
          }),
        ],
        [Result_5],
        [],
      ),
    'get_reservation' : IDL.Func([RoundId], [Result_1], ['query']),
    'get_rollover' : IDL.Func([AllocationId], [Result], ['query']),
    'get_round_balance' : IDL.Func([RoundId], [Result_4], []),
    'get_transfer' : IDL.Func([AllocationId], [Result_3], ['query']),
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
    'reconcile_round' : IDL.Func([RoundId], [Result_2], []),
    'reserve_round' : IDL.Func(
        [
          IDL.Record({
            'asset' : AssetId,
            'fund' : Hash32,
            'transfer_count' : IDL.Nat32,
            'round_id' : RoundId,
            'required_atoms' : IDL.Nat,
            'allocation_version' : Hash32,
          }),
        ],
        [Result_1],
        [],
      ),
    'rollover_carried' : IDL.Func(
        [
          IDL.Record({
            'amount_atoms' : IDL.Nat,
            'allocation_id' : AllocationId,
            'memo' : IDL.Vec(IDL.Nat8),
            'target_round' : RoundId,
            'source_round' : RoundId,
            'target_fund' : IDL.Vec(IDL.Nat8),
          }),
        ],
        [Result],
        [],
      ),
    'set_emergency_pause' : IDL.Func([IDL.Bool], [UnitResult], []),
  });
};
export const init = ({ IDL }) => { return []; };
