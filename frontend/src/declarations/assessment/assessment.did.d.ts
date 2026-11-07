import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface AllocationProposal {
  'evidence_hash' : Hash32,
  'user_id' : UserId,
  'weight_numerator' : bigint,
  'weight_denominator' : bigint,
  'evaluation_id' : EvaluationId,
}
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
export interface Config {
  'rate_limit_window_ns' : bigint,
  'allowed_prompt_versions' : Array<Hash32>,
  'audit_canister' : [] | [Principal],
  'max_weight_numerator' : bigint,
  'submitters' : Array<Principal>,
  'max_sources' : bigint,
  'max_attempts' : number,
  'allowed_source_hosts' : Array<string>,
  'max_input_bytes' : bigint,
  'rate_limit_count' : number,
  'allowed_models' : Array<string>,
}
export interface Evaluation {
  'id' : EvaluationId,
  'status' : EvaluationStatus,
  'prompt_version' : Hash32,
  'result_hash' : [] | [Hash32],
  'updated_at' : TimestampNs,
  'model_version' : string,
  'attempt' : number,
  'request_fingerprint' : Hash32,
  'attempt_token' : Hash32,
  'subject_user_id' : UserId,
  'created_at' : TimestampNs,
  'source_refs' : Array<SourceRef>,
  'outcome' : [] | [EvaluationOutcome],
  'input_hash' : Hash32,
  'idempotency_key' : Hash32,
}
export type EvaluationId = bigint;
export type EvaluationOutcome = { 'rejected' : string } |
  {
    'accepted' : { 'weight_numerator' : bigint, 'weight_denominator' : bigint }
  };
export type EvaluationStatus = { 'pending' : null } |
  { 'complete' : null } |
  { 'failed' : FailureClass };
export type FailureClass = { 'internal' : null } |
  { 'malformed_response' : null } |
  { 'provider_unavailable' : null } |
  { 'policy_rejected' : null } |
  { 'timeout' : null };
export type Hash32 = Uint8Array | number[];
export interface Page {
  'cursor' : [] | [Uint8Array | number[]],
  'limit' : number,
}
export type Result = { 'ok' : Evaluation } |
  { 'err' : AppError };
export type Result_1 = { 'ok' : AllocationProposal } |
  { 'err' : AppError };
export type Result_2 = {
    'ok' : {
      'next_cursor' : [] | [Uint8Array | number[]],
      'items' : Array<Evaluation>,
    }
  } |
  { 'err' : AppError };
export interface SourceRef {
  'allowed_uri' : [] | [string],
  'ordinal' : number,
  'uri_hash' : Hash32,
}
export interface SubmitInput {
  'prompt_version' : Uint8Array | number[],
  'model_version' : string,
  'subject_user_id' : bigint,
  'source_refs' : Array<SourceRef>,
  'input_text' : string,
  'idempotency_key' : Uint8Array | number[],
}
export type TimestampNs = bigint;
export type UnitResult = { 'ok' : null } |
  { 'err' : AppError };
export type UserId = bigint;
export interface _SERVICE {
  'budget_status' : ActorMethod<
    [],
    {
      'global_used' : number,
      'per_caller_limit' : number,
      'window_ns' : bigint,
      'global_limit' : number,
      'paused' : boolean,
    }
  >,
  'configure' : ActorMethod<[Config], UnitResult>,
  'configure_budget' : ActorMethod<
    [
      {
        'per_caller_limit' : number,
        'window_ns' : bigint,
        'global_limit' : number,
        'paused' : boolean,
      },
    ],
    UnitResult
  >,
  'configure_registry' : ActorMethod<[Principal], UnitResult>,
  'get_evaluation' : ActorMethod<[bigint], Result>,
  'get_evaluation_by_key' : ActorMethod<[Uint8Array | number[]], Result>,
  'interface_version' : ActorMethod<
    [],
    {
      'major' : number,
      'minor' : number,
      'patch' : number,
      'schema_hash' : Uint8Array | number[],
    }
  >,
  'list_evaluations' : ActorMethod<
    [{ 'subject' : [] | [bigint], 'page' : Page }],
    Result_2
  >,
  'propose_allocation' : ActorMethod<[bigint], Result_1>,
  'retry_evaluation' : ActorMethod<
    [{ 'evaluation_id' : bigint, 'input_text' : string }],
    Result
  >,
  'submit_evaluation' : ActorMethod<[SubmitInput], Result>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
