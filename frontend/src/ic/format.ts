const TEN = 10n
const NS_PER_MS = 1_000_000n

export const formatAtoms = (atoms: bigint, decimals: number): string => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError('Asset decimals must be an integer between 0 and 255')
  }
  const negative = atoms < 0n
  const absolute = negative ? -atoms : atoms
  if (decimals === 0) return `${negative ? '-' : ''}${absolute}`
  const scale = TEN ** BigInt(decimals)
  const whole = absolute / scale
  const fraction = (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export const nanosecondsToDate = (timestampNs: bigint): Date => {
  const milliseconds = timestampNs / NS_PER_MS
  const value = Number(milliseconds)
  if (!Number.isSafeInteger(value)) throw new RangeError('Timestamp is outside the JavaScript Date safe range')
  return new Date(value)
}

export const formatNanosecondTimestamp = (
  timestampNs: bigint,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string => new Intl.DateTimeFormat(locales, options).format(nanosecondsToDate(timestampNs))
