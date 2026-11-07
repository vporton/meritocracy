export const idlFactory = ({ IDL }) => {
  const Hash32 = IDL.Vec(IDL.Nat8);
  const Config = IDL.Record({
    'rate_limit_window_ns' : IDL.Nat64,
    'allowed_prompt_versions' : IDL.Vec(Hash32),
    'audit_canister' : IDL.Opt(IDL.Principal),
    'max_weight_numerator' : IDL.Nat,
    'submitters' : IDL.Vec(IDL.Principal),
    'max_sources' : IDL.Nat,
    'max_attempts' : IDL.Nat32,
    'allowed_source_hosts' : IDL.Vec(IDL.Text),
    'max_input_bytes' : IDL.Nat,
    'rate_limit_count' : IDL.Nat32,
    'allowed_models' : IDL.Vec(IDL.Text),
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
  const UnitResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : AppError });
  const EvaluationId = IDL.Nat64;
  const FailureClass = IDL.Variant({
    'internal' : IDL.Null,
    'malformed_response' : IDL.Null,
    'provider_unavailable' : IDL.Null,
    'policy_rejected' : IDL.Null,
    'timeout' : IDL.Null,
  });
  const EvaluationStatus = IDL.Variant({
    'pending' : IDL.Null,
    'complete' : IDL.Null,
    'failed' : FailureClass,
  });
  const TimestampNs = IDL.Int;
  const UserId = IDL.Nat64;
  const SourceRef = IDL.Record({
    'allowed_uri' : IDL.Opt(IDL.Text),
    'ordinal' : IDL.Nat32,
    'uri_hash' : Hash32,
  });
  const EvaluationOutcome = IDL.Variant({
    'rejected' : IDL.Text,
    'accepted' : IDL.Record({
      'weight_numerator' : IDL.Nat,
      'weight_denominator' : IDL.Nat,
    }),
  });
  const Evaluation = IDL.Record({
    'id' : EvaluationId,
    'status' : EvaluationStatus,
    'prompt_version' : Hash32,
    'result_hash' : IDL.Opt(Hash32),
    'updated_at' : TimestampNs,
    'model_version' : IDL.Text,
    'attempt' : IDL.Nat32,
    'request_fingerprint' : Hash32,
    'attempt_token' : Hash32,
    'subject_user_id' : UserId,
    'created_at' : TimestampNs,
    'source_refs' : IDL.Vec(SourceRef),
    'outcome' : IDL.Opt(EvaluationOutcome),
    'input_hash' : Hash32,
    'idempotency_key' : Hash32,
  });
  const Result = IDL.Variant({ 'ok' : Evaluation, 'err' : AppError });
  const Page = IDL.Record({
    'cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'limit' : IDL.Nat32,
  });
  const Result_2 = IDL.Variant({
    'ok' : IDL.Record({
      'next_cursor' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'items' : IDL.Vec(Evaluation),
    }),
    'err' : AppError,
  });
  const AllocationProposal = IDL.Record({
    'evidence_hash' : Hash32,
    'user_id' : UserId,
    'weight_numerator' : IDL.Nat,
    'weight_denominator' : IDL.Nat,
    'evaluation_id' : EvaluationId,
  });
  const Result_1 = IDL.Variant({ 'ok' : AllocationProposal, 'err' : AppError });
  const SubmitInput = IDL.Record({
    'prompt_version' : IDL.Vec(IDL.Nat8),
    'model_version' : IDL.Text,
    'subject_user_id' : IDL.Nat64,
    'source_refs' : IDL.Vec(SourceRef),
    'input_text' : IDL.Text,
    'idempotency_key' : IDL.Vec(IDL.Nat8),
  });
  return IDL.Service({
    'budget_status' : IDL.Func(
        [],
        [
          IDL.Record({
            'global_used' : IDL.Nat32,
            'per_caller_limit' : IDL.Nat32,
            'window_ns' : IDL.Nat64,
            'global_limit' : IDL.Nat32,
            'paused' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
    'configure' : IDL.Func([Config], [UnitResult], []),
    'configure_budget' : IDL.Func(
        [
          IDL.Record({
            'per_caller_limit' : IDL.Nat32,
            'window_ns' : IDL.Nat64,
            'global_limit' : IDL.Nat32,
            'paused' : IDL.Bool,
          }),
        ],
        [UnitResult],
        [],
      ),
    'configure_registry' : IDL.Func([IDL.Principal], [UnitResult], []),
    'get_evaluation' : IDL.Func([IDL.Nat64], [Result], ['query']),
    'get_evaluation_by_key' : IDL.Func(
        [IDL.Vec(IDL.Nat8)],
        [Result],
        ['query'],
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
    'list_evaluations' : IDL.Func(
        [IDL.Record({ 'subject' : IDL.Opt(IDL.Nat64), 'page' : Page })],
        [Result_2],
        ['query'],
      ),
    'propose_allocation' : IDL.Func([IDL.Nat64], [Result_1], ['query']),
    'retry_evaluation' : IDL.Func(
        [IDL.Record({ 'evaluation_id' : IDL.Nat64, 'input_text' : IDL.Text })],
        [Result],
        [],
      ),
    'submit_evaluation' : IDL.Func([SubmitInput], [Result], []),
  });
};
export const init = ({ IDL }) => { return []; };
