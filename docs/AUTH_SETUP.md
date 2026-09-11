# Authentication setup

The API is the OAuth client and the sole issuer of application sessions. The
frontend never receives provider client secrets, never exchanges authorization
codes, and never places bearer sessions in OAuth URLs.

## Required backend configuration

Copy `backend/env.example` to `backend/.env` and configure:

```env
API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
OAUTH_STATE_SECRET=<at-least-32-random-bytes>

GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ORCID_CLIENT_ID=...
ORCID_CLIENT_SECRET=...
BITBUCKET_CLIENT_ID=...
BITBUCKET_CLIENT_SECRET=...
GITLAB_CLIENT_ID=...
GITLAB_CLIENT_SECRET=...
```

Generate `OAUTH_STATE_SECRET` with a cryptographically secure generator, for
example `openssl rand -base64 48`. `JWT_SECRET` is accepted only as a temporary
fallback and must also contain at least 32 bytes.

Each provider callback must point to the API, not the frontend:

- GitHub: `${API_URL}/api/auth/github/callback`
- ORCID: `${API_URL}/api/auth/orcid/callback`
- Bitbucket: `${API_URL}/api/auth/bitbucket/callback`
- GitLab: `${API_URL}/api/auth/gitlab/callback`

The frontend only needs `VITE_API_URL`, wallet configuration, and other
non-OAuth public settings. OAuth client IDs do not belong in frontend build
arguments.

## Flow and security properties

1. The frontend calls `POST /api/auth/oauth/:provider/start` with credentials
   enabled.
2. The API creates a signed, ten-minute state value and binds it to an HttpOnly,
   SameSite nonce cookie.
3. The popup navigates to the returned provider authorization URL.
4. The provider redirects to the API callback. The API validates the signature,
   provider, expiry, and nonce before exchanging the one-time code.
5. The API sends the result directly to the exact configured frontend origin
   with `postMessage`; authorization codes and bearer sessions never enter a URL.

Provider handles submitted directly to `/login/:provider` are not credentials
and are rejected. Ethereum login similarly requires a fresh API challenge and a
valid wallet signature. Email registration does not authenticate the user;
successful consumption of the one-time email verification link creates the
session.

Session, email-verification, and KYC email-link credentials are stored as
SHA-256 digests. Applying migration `20260731000000_secure_authentication`
invalidates legacy plaintext credentials and therefore signs existing users out.

## Operations

Run all workspace commands from the repository root:

```bash
nvm use stable
npm run db:setup
npm run build
npm test
```

OAuth requires the browser to accept the API nonce cookie. Keep `API_URL` and
`FRONTEND_URL` on compatible HTTPS origins in production and configure CORS for
the exact frontend origin.
