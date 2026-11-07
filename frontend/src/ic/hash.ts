const HEX_PATTERN = /^[0-9a-fA-F]{64}$/

export const randomHash32 = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32))

export const sha256Text = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

export const parseHash32 = (value: string): Uint8Array => {
  if (!HEX_PATTERN.test(value)) throw new Error('Expected exactly 64 hexadecimal characters.')
  return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16))
}

export const shortHash = (value: Uint8Array | number[]): string =>
  Array.from(value).slice(0, 6).map((byte) => byte.toString(16).padStart(2, '0')).join('')
