/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRONTEND_URL?: string
  readonly VITE_API_URL?: string
  readonly VITE_ORCID_DOMAIN?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  readonly VITE_IC_HOST?: string
  readonly VITE_CANISTER_ID_REGISTRY?: string
  readonly VITE_CANISTER_ID_ASSESSMENT?: string
  readonly VITE_CANISTER_ID_ROUNDS?: string
  readonly VITE_CANISTER_ID_VAULT?: string
  readonly VITE_CANISTER_ID_AUDIT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
