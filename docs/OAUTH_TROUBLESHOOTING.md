# OAuth troubleshooting

OAuth authorization starts at `POST /api/auth/oauth/:provider/start` and returns
an authorization URL. All provider callbacks terminate on the backend.

## Configuration checks

- `API_URL` is the externally reachable API origin, with no trailing path.
- `FRONTEND_URL` is the exact browser origin allowed to receive the popup result.
- `OAUTH_STATE_SECRET` contains at least 32 random bytes.
- The provider client ID and secret exist only in backend configuration.
- The provider callback exactly matches `${API_URL}/api/auth/<provider>/callback`.
- Production API and frontend origins use HTTPS.

There are no `VITE_*_CLIENT_ID` or frontend callback variables. If an old
deployment still supplies them, remove those build arguments and rebuild.

## Common failures

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `OAuth state protection is not configured` | Missing or short state secret | Set a 32-byte-or-longer `OAUTH_STATE_SECRET` |
| `OAuth state validation failed` | Missing nonce cookie, stale popup, or tampered state | Allow the API cookie and start a fresh flow |
| Provider reports redirect mismatch | Registered callback differs | Compare the provider setting with `API_URL` exactly |
| Popup closes without login | Origin or opener mismatch | Check `FRONTEND_URL`, CORS, HTTPS, and popup blocking |
| `OAuth authentication failed` | Code exchange or provider user lookup failed | Check backend connectivity and provider credentials |
| Identity conflict | Provider identity already belongs to another user | Sign in to the owning account; accounts are not auto-merged |

The backend intentionally avoids logging authorization codes, provider access
tokens, state values, or full provider responses. Diagnose with HTTP status,
provider name, and correlation timestamps rather than adding secret-bearing logs.
