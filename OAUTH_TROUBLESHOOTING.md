# OAuth Troubleshooting Guide

## GitHub OAuth "Code passed is incorrect or expired" Error

This error typically occurs due to one of the following issues:

### 1. Missing redirect_uri in Token Exchange
**Issue**: GitHub requires the `redirect_uri` parameter to be included when exchanging the authorization code for an access token, and it must match exactly what was used in the authorization request.

**Solution**: ✅ **FIXED** - Added `redirect_uri` parameter to the token exchange request in `handleGitHubOAuth()`.

### 2. GitHub App Configuration Mismatch
**Check these in your GitHub OAuth App settings:**

- **Authorization callback URL** must be exactly: `http://localhost:5173/auth/github/callback` (for development)
- **Client ID** must match your `GITHUB_CLIENT_ID` environment variable
- **Client Secret** must match your `GITHUB_CLIENT_SECRET` environment variable

### 3. Environment Variables
Ensure your `.env` files are properly configured:

**Backend (.env):**
```env
GITHUB_CLIENT_ID=your-actual-github-client-id
GITHUB_CLIENT_SECRET=your-actual-github-client-secret
FRONTEND_URL=http://localhost:5173
```

**Frontend (.env):**
```env
VITE_GITHUB_CLIENT_ID=your-actual-github-client-id
VITE_GITHUB_REDIRECT_URI=http://localhost:5173/auth/github/callback
```

### 4. Code Expiration
OAuth authorization codes expire quickly (usually within 10 minutes). If there's a delay between:
- User authorizing on GitHub → Code being sent to your callback → Backend processing
The code might expire.

### 5. Development vs Production URLs
Make sure your GitHub OAuth App is configured for the correct environment:
- **Development**: `http://localhost:5173/auth/github/callback`
- **Production**: `https://yourdomain.com/auth/github/callback`

## Debugging Steps

### 1. Check Console Logs
The updated backend now includes detailed logging. Check your backend console for:
```
OAuth callback for github: { code: 'abc123...', codeLength: 20 }
GitHub token exchange failed: { status: 400, statusText: 'Bad Request', body: '...' }
```

### 2. Verify GitHub App Settings
1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Click on your app
3. Verify:
   - **Application name**: Any name you want
   - **Homepage URL**: `http://localhost:5173` (for dev)
   - **Authorization callback URL**: `http://localhost:5173/auth/github/callback`

### 3. Test OAuth Flow
1. Clear browser cache/cookies
2. Start backend: `cd backend && npm run dev`
3. Start frontend: `cd frontend && npm run dev`
4. Try GitHub login again
5. Check browser network tab for failed requests
6. Check backend console for detailed error logs

### 4. Common GitHub OAuth Errors

| Error | Cause | Solution |
|-------|--------|----------|
| `incorrect_client_credentials` | Wrong Client ID/Secret | Check environment variables |
| `redirect_uri_mismatch` | Callback URL doesn't match | Update GitHub app settings |
| `bad_verification_code` | Code expired or already used | Try fresh login attempt |

## Automated Configuration Check

Run the configuration checker to diagnose common issues:

```bash
node oauth-debug.js
```

This script will check your environment files and identify missing or misconfigured OAuth settings.

## Manual Configuration Steps

### Step 1: Create Environment Files

If you haven't already, create your environment files:

```bash
# Backend
cp backend/env.example backend/.env

# Frontend  
cp frontend/env.example frontend/.env
```

### Step 2: Configure GitHub OAuth App

1. Go to GitHub → Settings → Developer settings → OAuth Apps → Your App
2. Set these values:
   - **Homepage URL**: `http://localhost:5173` 
   - **Authorization callback URL**: `http://localhost:5173/auth/github/callback`

### Step 3: Update Environment Variables

**Backend (.env):**
```env
GITHUB_CLIENT_ID=your-actual-github-client-id-from-oauth-app
GITHUB_CLIENT_SECRET=your-actual-github-client-secret-from-oauth-app
FRONTEND_URL=http://localhost:5173
```

**Frontend (.env):**
```env
VITE_GITHUB_CLIENT_ID=your-actual-github-client-id-from-oauth-app
VITE_GITHUB_REDIRECT_URI=http://localhost:5173/auth/github/callback
```

⚠️ **Important**: The `GITHUB_CLIENT_ID` must be identical in both files.

### Step 4: Restart Servers

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```

## Enhanced Error Diagnostics

The backend now includes detailed logging. When you encounter the error, check your backend console for output like:

```
=== OAuth Callback for github ===
=== GitHub OAuth Handler ===
GitHub token exchange request: { client_id: 'abc123', redirect_uri: 'http://localhost:5173/auth/github/callback' }
GitHub OAuth token error: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }
```

This will help identify the specific issue (wrong client ID, mismatched redirect URI, expired code, etc.).

## Quick Fixes for Common Issues

### ❌ "incorrect_client_credentials"
- Client ID or secret is wrong
- Check GitHub OAuth App settings vs environment variables

### ❌ "redirect_uri_mismatch" 
- Callback URL in GitHub app ≠ redirect URI in code
- Ensure both are exactly: `http://localhost:5173/auth/github/callback`

### ❌ "bad_verification_code"
- Code expired (try again immediately)
- Code already used (try fresh login)
- Network/timing issue (check for delays)

### ❌ Missing environment variables
- Run `node oauth-debug.js` to check configuration
- Ensure both frontend and backend .env files exist and are configured

If you're still experiencing issues, the enhanced logging will now provide much more specific error details to help identify the exact problem.
