import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
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
export interface BatchExecution {
  'transfers' : Array<Transfer>,
  'round_id' : RoundId,
}
export type Hash32 = Uint8Array | number[];
export interface PreparedTransfer {
  'to' : Account,
  'amount_atoms' : bigint,
  'allocation_id' : AllocationId,
  'memo' : Hash32,
  'created_at_time' : bigint,
}
export interface Reconciliation {
  'reconciled' : boolean,
  'reserved_atoms' : bigint,
  'deficit_atoms' : bigint,
  'excess_atoms' : bigint,
  'ledger_atoms' : bigint,
  'round_id' : RoundId,
  'checked_at' : TimestampNs,
}
export interface Reservation {
  'asset' : AssetId,
  'fund' : Hash32,
  'finalized_outstanding_atoms' : [] | [bigint],
  'transfer_count' : number,
  'reserved_atoms' : bigint,
  'fee_budget_atoms' : bigint,
  'finalized_outstanding_count' : [] | [number],
  'account' : Account,
  'round_id' : RoundId,
  'required_atoms' : bigint,
  'allocation_version' : Hash32,
  'accounting_deficit_atoms' : bigint,
}
export type Result = { 'ok' : Rollover } |
  { 'err' : AppError };
export type Result_1 = { 'ok' : Reservation } |
  { 'err' : AppError };
export type Result_2 = { 'ok' : Reconciliation } |
  { 'err' : AppError };
export type Result_3 = { 'ok' : Transfer } |
  { 'err' : AppError };
export type Result_4 = {
    'ok' : { 'atoms' : bigint, 'checked_at' : TimestampNs }
  } |
  { 'err' : AppError };
export type Result_5 = { 'ok' : BatchExecution } |
  { 'err' : AppError };
export interface Rollover {
  'to' : Account,
  'amount_atoms' : bigint,
  'fee_atoms' : bigint,
  'allocation_id' : AllocationId,
  'memo' : Hash32,
  'target_round' : RoundId,
  'state' : RolloverState,
  'source_round' : RoundId,
  'created_at_time' : bigint,
}
export type RolloverState = { 'permanent_failure' : string } |
  { 'sent' : bigint } |
  { 'prepared' : null } |
  { 'retryable_failure' : string };
export type RoundId = bigint;
export type TimestampNs = bigint;
export interface Transfer {
  'to' : Account,
  'amount_atoms' : bigint,
  'fee_atoms' : [] | [bigint],
  'allocation_id' : AllocationId,
  'memo' : Hash32,
  'state' : TransferState,
  'created_at_time' : bigint,
}
export type TransferState = { 'permanent_failure' : string } |
  { 'sent' : bigint } |
  { 'prepared' : null } |
  { 'executing' : number } |
  { 'retryable_failure' : string };
export type UnitResult = { 'ok' : null } |
  { 'err' : AppError };
export interface _SERVICE {
  'close_round' : ActorMethod<
    [
      {
        'outstanding_atoms' : bigint,
        'round_id' : RoundId,
        'outstanding_count' : number,
      },
    ],
    Result_1
  >,
  'configure_authorities' : ActorMethod<
    [{ 'supported_ledgers' : Array<Principal>, 'rounds_canister' : Principal }],
    UnitResult
  >,
  'derive_round_account' : ActorMethod<
    [{ 'asset' : AssetId, 'fund' : Hash32, 'round_id' : RoundId }],
    Account
  >,
  'emergency_pause_status' : ActorMethod<[], boolean>,
  'execute_batch' : ActorMethod<
    [
      {
        'transfers' : Array<PreparedTransfer>,
        'round_id' : RoundId,
        'allocation_version' : Hash32,
      },
    ],
    Result_5
  >,
  'get_reservation' : ActorMethod<[RoundId], Result_1>,
  'get_rollover' : ActorMethod<[AllocationId], Result>,
  'get_round_balance' : ActorMethod<[RoundId], Result_4>,
  'get_transfer' : ActorMethod<[AllocationId], Result_3>,
  'interface_version' : ActorMethod<
    [],
    {
      'major' : number,
      'minor' : number,
      'patch' : number,
      'schema_hash' : Uint8Array | number[],
    }
  >,
  'reconcile_round' : ActorMethod<[RoundId], Result_2>,
  'reserve_round' : ActorMethod<
    [
      {
        'asset' : AssetId,
        'fund' : Hash32,
        'transfer_count' : number,
        'round_id' : RoundId,
        'required_atoms' : bigint,
        'allocation_version' : Hash32,
      },
    ],
    Result_1
  >,
  'rollover_carried' : ActorMethod<
    [
      {
        'amount_atoms' : bigint,
        'allocation_id' : AllocationId,
        'memo' : Uint8Array | number[],
        'target_round' : RoundId,
        'source_round' : RoundId,
        'target_fund' : Uint8Array | number[],
      },
    ],
    Result
  >,
  'set_emergency_pause' : ActorMethod<[boolean], UnitResult>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
