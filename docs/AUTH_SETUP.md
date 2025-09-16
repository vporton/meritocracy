# Authentication System Setup Guide

## Overview

This application includes a comprehensive multi-provider authentication system that supports:

- **Ethereum/Web3 Login** (using WAGMI)
- **ORCID OAuth** (for academic users)
- **GitHub OAuth** (for developers)
- **BitBucket OAuth** (for Atlassian users)
- **GitLab OAuth** (for GitLab users)

## Key Features

- **Automatic User Merging**: If you log in with different providers that belong to the same person, the system automatically merges your accounts
- **Session Management**: JWT-based sessions with automatic cleanup
- **Secure Authentication**: All OAuth flows handled securely with proper token management

## Backend Setup

### 1. Environment Configuration

Copy the backend environment file and configure it:

```bash
cp backend/env.example backend/.env
```

Update the following variables in `backend/.env`:

```env
# Database
DATABASE_URL="file:./dev.db"

# JWT Secret (change this in production!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# OAuth Provider Configuration
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

ORCID_CLIENT_ID=your-orcid-client-id
ORCID_CLIENT_SECRET=your-orcid-client-secret

BITBUCKET_CLIENT_ID=your-bitbucket-client-id
BITBUCKET_CLIENT_SECRET=your-bitbucket-client-secret

GITLAB_CLIENT_ID=your-gitlab-client-id
GITLAB_CLIENT_SECRET=your-gitlab-client-secret
```

### 2. Database Migration

The authentication system requires a database migration to add the Session model:

```bash
cd backend
npm run db:migrate
```

### 3. OAuth App Setup

You need to create OAuth applications for each provider:

#### GitHub OAuth App
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click "New OAuth App"
3. Set Authorization callback URL to: `http://localhost:5173/auth/github/callback`
4. Copy the Client ID and Client Secret to your `.env` file

#### ORCID OAuth App
1. Go to ORCID Developer Tools
2. Register a new application
3. Set redirect URI to: `http://localhost:5173/auth/orcid/callback`
4. Copy the Client ID and Client Secret to your `.env` file

#### BitBucket OAuth App
1. Go to BitBucket Settings > OAuth consumers
2. Create a new consumer
3. Set callback URL to: `http://localhost:5173/auth/bitbucket/callback`
4. Copy the Key and Secret to your `.env` file

#### GitLab OAuth App
1. Go to GitLab Applications settings
2. Create a new application
3. Set redirect URI to: `http://localhost:5173/auth/gitlab/callback`
4. Copy the Application ID and Secret to your `.env` file

## Frontend Setup

### 1. Environment Configuration

Copy the frontend environment file:

```bash
cp frontend/env.example frontend/.env
```

Update the following variables in `frontend/.env`:

```env
# API Configuration
VITE_API_URL=http://localhost:3001

# Web3/Ethereum Configuration
VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id

# OAuth Configuration (Client IDs only - secrets stay on backend)
VITE_GITHUB_CLIENT_ID=your-github-client-id
VITE_ORCID_CLIENT_ID=your-orcid-client-id
VITE_BITBUCKET_CLIENT_ID=your-bitbucket-client-id
VITE_GITLAB_CLIENT_ID=your-gitlab-client-id
```

### 2. WalletConnect Setup (for Ethereum login)

1. Go to [WalletConnect Cloud](https://cloud.walletconnect.com/)
2. Create a new project
3. Copy the Project ID to your `.env` file as `VITE_WALLETCONNECT_PROJECT_ID`

## Running the Application

1. Start the backend:
```bash
cd backend
npm run dev
```

2. Start the frontend:
```bash
cd frontend
npm run dev
```

3. Visit `http://localhost:5173/login` to test the authentication system

## API Endpoints

The authentication system provides the following API endpoints:

- `POST /api/auth/login/ethereum` - Ethereum wallet login
- `POST /api/auth/login/orcid` - ORCID OAuth login
- `POST /api/auth/login/github` - GitHub OAuth login
- `POST /api/auth/login/bitbucket` - BitBucket OAuth login
- `POST /api/auth/login/gitlab` - GitLab OAuth login
- `POST /api/auth/logout` - Logout (invalidate session)
- `GET /api/auth/me` - Get current user
- `DELETE /api/auth/sessions/cleanup` - Cleanup expired sessions

## User Matching Logic

The system implements intelligent user matching and merging:

1. **No existing user**: Creates a new user account
2. **One matching user**: Updates the existing user with new provider information
3. **Multiple matching users**: Deletes the old user accounts and creates a new merged account

Matching is based on unique fields in the User model:
- `email`
- `ethereumAddress`
- `orcidId`
- `githubHandle`
- `bitbucketHandle`
- `gitlabHandle`

## Security Considerations

- JWT secrets should be strong and unique in production
- OAuth client secrets must never be exposed to the frontend
- All OAuth flows are handled securely with proper token validation
- Sessions have automatic expiration (7 days by default)
- Regular session cleanup prevents token accumulation

## Troubleshooting

### Common Issues

1. **OAuth callback errors**: Ensure redirect URIs in OAuth apps match exactly what's in your `.env` file
2. **Wallet connection issues**: Ensure WalletConnect Project ID is correctly configured
3. **CORS issues**: Ensure frontend URL is properly configured in backend CORS settings

### Testing OAuth Without Full Setup

For development, you can test the authentication flow by:
1. Commenting out OAuth provider buttons you haven't configured
2. Using the Ethereum login with a test wallet
3. Creating test user accounts manually in the database
