/**
 * Formats a stored GDP fraction for people. GDP shares are stored as fractions
 * (where 1 is 100%), so UI callers must not display the raw value as a percent.
 */
export function formatGdpSharePercentage(share: number): string {
  if (!Number.isFinite(share)) return 'N/A'

  return `${(share * 100).toLocaleString(undefined, {
    maximumSignificantDigits: 6,
    useGrouping: false
  })}%`
}
