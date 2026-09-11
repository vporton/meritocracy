const LOCAL_FRONTEND_URL = 'http://localhost:5173'
const LOCAL_API_URL = 'http://localhost:3001'
const API_HOST_PREFIX = 'api.'

const runtimeLocation = typeof window !== 'undefined' ? window.location : undefined

const isLocalHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '0.0.0.0' ||
  hostname === '::1'

const stripApiPrefix = (hostname: string) =>
  hostname.startsWith(API_HOST_PREFIX) ? hostname.slice(API_HOST_PREFIX.length) : hostname

const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin
  } catch {
    return value.trim().replace(/\/+$/, '')
  }
}

const configuredFrontendOrigin = () => {
  const value = import.meta.env.VITE_FRONTEND_URL?.trim()
  return value ? normalizeOrigin(value) : ''
}

const configuredApiOrigin = () => {
  const value = import.meta.env.VITE_API_URL?.trim()
  return value ? normalizeOrigin(value) : ''
}

export const getFrontendOrigin = (): string => {
  if (!runtimeLocation) {
    return configuredFrontendOrigin() || LOCAL_FRONTEND_URL
  }

  const { hostname, origin, protocol } = runtimeLocation
  if (isLocalHost(hostname)) {
    return configuredFrontendOrigin() || origin
  }

  if (hostname.startsWith(API_HOST_PREFIX)) {
    return `${protocol}//${stripApiPrefix(hostname)}`
  }

  return origin
}

export const getApiOrigin = (): string => {
  if (!runtimeLocation) {
    return configuredApiOrigin() || LOCAL_API_URL
  }

  const { hostname, origin, protocol } = runtimeLocation
  if (isLocalHost(hostname)) {
    return configuredApiOrigin() || LOCAL_API_URL
  }

  if (hostname.startsWith(API_HOST_PREFIX)) {
    return origin
  }

  return `${protocol}//${API_HOST_PREFIX}${hostname}`
}
