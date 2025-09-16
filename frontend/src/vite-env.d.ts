/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_ORCID_CLIENT_ID: string
  readonly VITE_BITBUCKET_CLIENT_ID: string
  readonly VITE_GITLAB_CLIENT_ID: string
  readonly VITE_ORCID_DOMAIN: string
  readonly VITE_WALLETCONNECT_PROJECT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
