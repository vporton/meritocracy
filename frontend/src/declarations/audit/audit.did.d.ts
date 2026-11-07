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
export interface AuditEvent {
  'actor' : Principal,
  'subject' : AuditSubject,
  'public_payload' : Uint8Array | number[],
  'kind' : AuditKind,
  'occurred_at' : TimestampNs,
  'event_id' : Hash32,
  'payload_hash' : Hash32,
}
export type AuditKind = { 'evaluation' : null } |
  { 'attestation' : null } |
  { 'session' : null } |
  { 'dispute' : null } |
  { 'governance' : null } |
  { 'reconciliation' : null } |
  { 'transfer' : null } |
  { 'round' : null } |
  { 'profile' : null };
export interface AuditPage {
  'next_cursor' : [] | [Uint8Array | number[]],
  'items' : Array<AuditEvent>,
}
export type AuditSubject = { 'evaluation' : bigint } |
  { 'user' : UserId } |
  { 'allocation' : bigint } |
  { 'round' : RoundId } |
  { 'system' : string };
export type Hash32 = Uint8Array | number[];
export type Result = { 'ok' : UserReport } |
  { 'err' : AppError };
export type Result_1 = { 'ok' : RoundReport } |
  { 'err' : AppError };
export type Result_2 = { 'ok' : AuditPage } |
  { 'err' : AppError };
export type Result_3 = { 'ok' : AuditEvent } |
  { 'err' : AppError };
export type RoundId = bigint;
export interface RoundReport {
  'last_event_at' : [] | [TimestampNs],
  'event_count' : bigint,
  'round_id' : RoundId,
  'event_root' : Hash32,
}
export type TimestampNs = bigint;
export type UnitResult = { 'ok' : null } |
  { 'err' : AppError };
export type UserId = bigint;
export interface UserReport { 'user_id' : UserId, 'events' : AuditPage }
export interface _SERVICE {
  'append' : ActorMethod<[AuditEvent], Result_3>,
  'configure_authorities' : ActorMethod<
    [{ 'appenders' : Array<Principal> }],
    UnitResult
  >,
  'get_event' : ActorMethod<[Uint8Array | number[]], Result_3>,
  'interface_version' : ActorMethod<
    [],
    {
      'major' : number,
      'minor' : number,
      'patch' : number,
      'schema_hash' : Uint8Array | number[],
    }
  >,
  'list_events' : ActorMethod<
    [
      {
        'to' : [] | [TimestampNs],
        'subject' : [] | [AuditSubject],
        'from' : [] | [TimestampNs],
        'kind' : [] | [AuditKind],
        'page' : { 'cursor' : [] | [Uint8Array | number[]], 'limit' : number },
      },
    ],
    Result_2
  >,
  'report_round' : ActorMethod<[RoundId], Result_1>,
  'report_user' : ActorMethod<
    [UserId, { 'cursor' : [] | [Uint8Array | number[]], 'limit' : number }],
    Result
  >,
  'storage_stats' : ActorMethod<
    [],
    { 'public_payload_bytes' : bigint, 'events' : bigint }
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
