/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRONTEND_URL?: string
  readonly VITE_API_URL?: string
  readonly VITE_ORCID_DOMAIN?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
