export type CandidOptional<T> = [] | [T]
export type CandidResult<T, E> = { ok: T } | { err: E }

export const optional = <T>(value: CandidOptional<T>): T | undefined => value[0]

export const toOptional = <T>(value: T | null | undefined): CandidOptional<T> =>
  value == null ? [] : [value]

export const variantTag = <T extends Record<string, unknown>>(value: T): keyof T => {
  const keys = Object.keys(value) as Array<keyof T>
  if (keys.length !== 1) throw new Error('Expected exactly one Candid variant tag')
  return keys[0]
}

export const unwrapResult = <T, E>(result: CandidResult<T, E>): T => {
  if ('ok' in result) return result.ok
  throw new IcCallError(result.err)
}

type AppErrorLike = Record<string, unknown>

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Your session is not authorized.',
  forbidden: 'You do not have permission to perform this action.',
  not_found: 'The requested record was not found.',
  expired: 'This request or session has expired.',
  paused: 'This operation is temporarily paused.',
}

export class IcCallError extends Error {
  readonly tag: string
  readonly detail: unknown
  readonly retryAfterNs?: bigint

  constructor(error: unknown) {
    const normalized = normalizeAppError(error)
    super(normalized.message)
    this.name = 'IcCallError'
    this.tag = normalized.tag
    this.detail = normalized.detail
    this.retryAfterNs = normalized.retryAfterNs
  }
}

export const normalizeAppError = (error: unknown): {
  tag: string
  detail: unknown
  message: string
  retryAfterNs?: bigint
} => {
  if (typeof error !== 'object' || error === null) {
    return { tag: 'unknown', detail: error, message: 'The canister returned an unknown error.' }
  }
  const record = error as AppErrorLike
  const keys = Object.keys(record)
  if (keys.length !== 1) {
    return { tag: 'unknown', detail: error, message: 'The canister returned an invalid error value.' }
  }
  const tag = keys[0]
  const detail = record[tag]
  if (tag === 'rate_limited' && typeof detail === 'object' && detail !== null && 'retry_after_ns' in detail) {
    const retryAfterNs = (detail as { retry_after_ns: bigint }).retry_after_ns
    return { tag, detail, retryAfterNs, message: 'Too many requests. Please retry later.' }
  }
  const text = typeof detail === 'string' ? detail : undefined
  return {
    tag,
    detail,
    message: text ?? ERROR_MESSAGES[tag] ?? 'The canister rejected the request.',
  }
}
