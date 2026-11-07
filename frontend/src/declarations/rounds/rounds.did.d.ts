import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface Allocation {
  'state' : AllocationState,
  'draft' : AllocationDraft,
  'recipient_hash' : [] | [Hash32],
}
export interface AllocationDraft {
  'id' : AllocationId,
  'evidence_hash' : Hash32,
  'amount_atoms' : bigint,
  'user_id' : UserId,
}
export type AllocationId = bigint;
export type AllocationState = { 'pending' : null } |
  { 'paid' : bigint } |
  { 'frozen' : null } |
  { 'carried' : string };
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
export interface Dispute {
  'id' : bigint,
  'evidence_hash' : Hash32,
  'allocation_id' : AllocationId,
  'created_at' : TimestampNs,
  'state' : DisputeState,
  'reason_code' : string,
  'round_id' : RoundId,
}
export type DisputeResolution = { 'reject' : null } |
  { 'uphold' : null };
export type DisputeState = { 'open' : null } |
  { 'upheld' : null } |
  { 'rejected' : null };
export interface ExecutionSummary {
  'sent' : number,
  'prepared' : number,
  'carried' : number,
  'retryable' : number,
}
export type Hash32 = Uint8Array | number[];
export interface Page {
  'cursor' : [] | [Uint8Array | number[]],
  'limit' : number,
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
export type Result = { 'ok' : Round } |
  { 'err' : AppError };
export type Result_1 = { 'ok' : Allocation } |
  { 'err' : AppError };
export type Result_2 = { 'ok' : ExecutionSummary } |
  { 'err' : AppError };
export type Result_3 = { 'ok' : Dispute } |
  { 'err' : AppError };
export type Result_4 = { 'ok' : Reconciliation } |
  { 'err' : AppError };
export type Result_5 = { 'ok' : Uint8Array | number[] } |
  { 'err' : AppError };
export type Result_6 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<Round>,
    }
  } |
  { 'err' : AppError };
export type Result_7 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<Dispute>,
    }
  } |
  { 'err' : AppError };
export type Result_8 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<Allocation>,
    }
  } |
  { 'err' : AppError };
export interface Round {
  'id' : RoundId,
  'status' : RoundStatus,
  'asset' : AssetId,
  'reserved_atoms' : bigint,
  'source_fund' : Hash32,
  'vault_subaccount' : Uint8Array | number[],
  'required_atoms' : bigint,
  'dispute_ends_at' : [] | [TimestampNs],
  'allocation_version' : [] | [Hash32],
}
export type RoundId = bigint;
export type RoundStatus = { 'funded' : null } |
  { 'complete' : null } |
  { 'executing' : null } |
  { 'draft' : null } |
  { 'paused' : null } |
  { 'disputing' : null };
export type TimestampNs = bigint;
export type UnitResult = { 'ok' : null } |
  { 'err' : AppError };
export type UserId = bigint;
export interface _SERVICE {
  'configure_authorities' : ActorMethod<
    [
      {
        'audit_canister' : Principal,
        'managers' : Array<Principal>,
        'vault_canister' : Principal,
        'dispute_resolvers' : Array<Principal>,
        'registry_canister' : Principal,
      },
    ],
    UnitResult
  >,
  'create_draft' : ActorMethod<
    [
      {
        'asset' : AssetId,
        'source_fund' : Uint8Array | number[],
        'required_atoms' : bigint,
      },
    ],
    Result
  >,
  'execute_due' : ActorMethod<[RoundId], Result_2>,
  'file_dispute' : ActorMethod<
    [
      {
        'evidence_hash' : Uint8Array | number[],
        'allocation_id' : AllocationId,
        'reason_code' : string,
        'round_id' : RoundId,
      },
    ],
    Result_3
  >,
  'finalize' : ActorMethod<[RoundId], Result>,
  'get_dispute' : ActorMethod<[bigint], Result_3>,
  'get_round' : ActorMethod<[RoundId], Result>,
  'interface_version' : ActorMethod<
    [],
    {
      'major' : number,
      'minor' : number,
      'patch' : number,
      'schema_hash' : Uint8Array | number[],
    }
  >,
  'list_allocations' : ActorMethod<[RoundId, Page], Result_8>,
  'list_disputes' : ActorMethod<
    [
      {
        'page' : Page,
        'state' : [] | [DisputeState],
        'round_id' : [] | [RoundId],
      },
    ],
    Result_7
  >,
  'list_rounds' : ActorMethod<
    [{ 'status' : [] | [RoundStatus], 'page' : Page }],
    Result_6
  >,
  'put_allocation_version' : ActorMethod<
    [
      {
        'expected_previous_version' : [] | [Uint8Array | number[]],
        'allocations' : Array<AllocationDraft>,
        'round_id' : RoundId,
      },
    ],
    Result_5
  >,
  'reconcile' : ActorMethod<[RoundId], Result_4>,
  'resolve_dispute' : ActorMethod<
    [{ 'dispute_id' : bigint, 'resolution' : DisputeResolution }],
    Result_3
  >,
  'retry_execution' : ActorMethod<[RoundId], Result_2>,
  'rollover_carried' : ActorMethod<
    [
      {
        'source_allocation_id' : AllocationId,
        'target_round' : RoundId,
        'target_allocation_id' : AllocationId,
      },
    ],
    UnitResult
  >,
  'settle_frozen_to_carried' : ActorMethod<
    [{ 'dispute_id' : bigint, 'reason' : string }],
    Result_1
  >,
  'verify_funding' : ActorMethod<[RoundId], Result>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
