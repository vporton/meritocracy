import { Ed25519KeyIdentity } from '@icp-sdk/core/identity'

const SESSION_KEY = 'meritocracy.icp.session-identity.v1'

/**
 * Session keys are deliberately tab-scoped. sessionStorage survives an OAuth
 * redirect in the same tab but is cleared when the tab closes. It must never
 * be promoted to localStorage or sent to an application server.
 */
export const loadOrCreateSessionIdentity = (): Ed25519KeyIdentity => {
  const stored = window.sessionStorage.getItem(SESSION_KEY)
  if (stored) {
    try {
      return Ed25519KeyIdentity.fromJSON(stored)
    } catch {
      window.sessionStorage.removeItem(SESSION_KEY)
    }
  }
  const identity = Ed25519KeyIdentity.generate()
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(identity.toJSON()))
  return identity
}

export const clearSessionIdentity = (): void => {
  window.sessionStorage.removeItem(SESSION_KEY)
}
