// Polyfills for Node.js modules in the browser
import { Buffer } from 'buffer'

// Make Buffer available globally
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer
  (window as any).global = window
  
  // Polyfill crypto.getRandomValues if not available
  if (!window.crypto) {
    (window as any).crypto = {}
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
