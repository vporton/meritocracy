// Polyfills for Node.js modules in the browser
import { Buffer } from 'buffer'

const root = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
  process?: { env?: Record<string, string> }
}

root.Buffer = Buffer
root.global = root

if (typeof window !== 'undefined') {
  ;(window as any).Buffer = Buffer
  ;(window as any).global = window

  // Polyfill crypto.getRandomValues if not available
  if (!window.crypto) {
    ;(window as any).crypto = {}
  }

  if (!window.crypto.getRandomValues) {
    window.crypto.getRandomValues = function(array: any) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256)
      }
      return array
    }
  }
}

// Additional crypto polyfill for Vite
if (typeof globalThis !== 'undefined' && !globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues: function(array: any) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256)
      }
      return array
    }
  } as any
}

if (!root.process) {
  root.process = { env: {} }
} else if (!root.process.env) {
  root.process.env = {}
}

const getCrypto = (): Crypto | undefined => {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    return globalThis.crypto
  }

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    return window.crypto
  }

  return undefined
}

const fillWithFallback = (array: Uint8Array) => {
  const crypto = getCrypto()
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(array)
    return array
  }

  for (let index = 0; index < array.length; index += 1) {
    array[index] = Math.floor(Math.random() * 256)
  }

  return array
}

const normalizeTarget = (buf: Buffer | Uint8Array) => {
  if (buf instanceof Uint8Array) {
    return buf
  }

  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export const randomFillSync = (buf: Buffer | Uint8Array, offset = 0, size = buf.length) => {
  const target = normalizeTarget(buf)
  fillWithFallback(target.subarray(offset, offset + size))
  return buf
}

export const randomFill = (
  buf: Buffer | Uint8Array,
  offsetOrCallback?: number | ((err: Error | null, buf: Buffer | Uint8Array) => void),
  sizeOrCallback?: number | ((err: Error | null, buf: Buffer | Uint8Array) => void),
  callback?: (err: Error | null, buf: Buffer | Uint8Array) => void,
) => {
  let offset = 0
  let size = buf.length
  let cb = callback

  if (typeof offsetOrCallback === 'function') {
    cb = offsetOrCallback
  } else if (typeof sizeOrCallback === 'function') {
    offset = offsetOrCallback ?? 0
    cb = sizeOrCallback
    size = buf.length - offset
  } else {
    offset = offsetOrCallback ?? 0
    size = sizeOrCallback ?? (buf.length - offset)
  }

  randomFillSync(buf, offset, size)

  if (cb) {
    queueMicrotask(() => cb?.(null, buf))
    return
  }

  return buf
}
