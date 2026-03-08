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
