import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { getCurrentUserFromToken } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Track ongoing OAuth requests to prevent duplicates
const ongoingOAuthRequests = new Map<string, number>();
// Cache successful OAuth results for a short time to handle duplicates
const oauthResultCache = new Map<string, any>();

// Remove duplicate auth middleware - now imported from shared module

// Helper function to verify Ethereum signature
function verifyEthereumSignature(address: string, message: string, signature: string): boolean {
  try {
    // Recover the address from the signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    // Normalize addresses to lowercase for comparison
    const normalizedAddress = address.toLowerCase();
    const normalizedRecovered = recoveredAddress.toLowerCase();
    
    return normalizedAddress === normalizedRecovered;
  } catch (error) {
    console.error('Error verifying Ethereum signature:', error);
    return false;
  }
}

interface UserData {
  email?: string;
  name?: string;
  ethereumAddress?: string;
  orcidId?: string;
  githubHandle?: string;
  bitbucketHandle?: string;
  gitlabHandle?: string;
}

// Helper function to find or create user based on provided data.
//
// TODO@P3: Document in more details.
// Consider we have two users:
// A0 A1
// B0 B1
// and set B1 to A1. Then we need to deal only with two users, because A1!=B1.
// We delete that user that had been previously set to our data!
async function findOrCreateUser(userData: UserData, currentUserId: number | null = null) {
  const { email, name, ethereumAddress, orcidId, githubHandle, bitbucketHandle, gitlabHandle } = userData;
  // First, check for exact matches using unique fields
  const searchConditions: UserData[] = [];
  // if (email) searchConditions.push({ email });
  if (ethereumAddress) searchConditions.push({ ethereumAddress });
  if (orcidId) searchConditions.push({ orcidId });
  if (githubHandle) searchConditions.push({ githubHandle });
  if (bitbucketHandle) searchConditions.push({ bitbucketHandle });
  if (gitlabHandle) searchConditions.push({ gitlabHandle });

  if (searchConditions.length === 0) {
    throw new Error('No identifying information provided');
  }

  // Due to the unique fields, only one user can match.
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: searchConditions
    }
  });

  if (existingUser === null) {
    // No existing user found
    if (currentUserId !== null) {
      // If there's a current user, update them with the new provider info instead of creating a new user
      // First get the current user to preserve existing data
      const currentUser = await prisma.user.findUnique({
        where: { id: currentUserId }
      });
      
      if (!currentUser) {
        throw new Error('Current user not found');
      }
      
      return await prisma.user.update({
        where: { id: currentUserId },
        data: {
          // Only update fields that are provided, preserve existing data
          email: email || currentUser.email,
          name: name || currentUser.name,
          ethereumAddress: ethereumAddress || currentUser.ethereumAddress,
          orcidId: orcidId || currentUser.orcidId,
          githubHandle: githubHandle || currentUser.githubHandle,
          bitbucketHandle: bitbucketHandle || currentUser.bitbucketHandle,
          gitlabHandle: gitlabHandle || currentUser.gitlabHandle,
        }
      });
    } else {
      // No current user, create new one
      return await prisma.user.create({
        data: {
          name,
          ethereumAddress,
          orcidId,
          githubHandle,
          bitbucketHandle,
          gitlabHandle
        }
      });
    }
  } else {
    // TODO@P2: DB transaction
    // One user found, update with new information
    if (currentUserId !== null && currentUserId !== existingUser.id) {
      // If there's a current user that's different from the existing user,
      // merge the existing user's data into the current user and delete the existing user
      await prisma.user.delete({where: {id: existingUser.id}});
      return await prisma.user.update({
        where: { id: currentUserId },
        data: {
          // Merge existing user data with new provider data
          email: email || existingUser.email || undefined,
          name: name || existingUser.name || undefined,
          ethereumAddress: ethereumAddress || existingUser.ethereumAddress || undefined,
          orcidId: orcidId || existingUser.orcidId || undefined,
          githubHandle: githubHandle || existingUser.githubHandle || undefined,
          bitbucketHandle: bitbucketHandle || existingUser.bitbucketHandle || undefined,
          gitlabHandle: gitlabHandle || existingUser.gitlabHandle || undefined,
        }
      });
    } else {
      // Either no current user or current user is the same as existing user
      return await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          email: email || existingUser.email,
          name: name || existingUser.name,
          ethereumAddress: ethereumAddress || existingUser.ethereumAddress,
          orcidId: orcidId || existingUser.orcidId,
          githubHandle: githubHandle || existingUser.githubHandle,
          bitbucketHandle: bitbucketHandle || existingUser.bitbucketHandle,
          gitlabHandle: gitlabHandle || existingUser.gitlabHandle
        }
      });
    }
  }
}

// Helper function to create session
async function createSession(userId: number) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET || 'fallback-secret', { 
    expiresIn: '7d' 
  });
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now
  
  const session = await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt
    }
  });
  
  return session;
}

// Ethereum login endpoint
router.post('/login/ethereum', async (req, res): Promise<void> => {
  try {
    const { ethereumAddress, signature, message, name } = req.body;
    
    if (!ethereumAddress) {
      res.status(400).json({ error: 'Ethereum address is required' });
      return;
    }

    if (!signature) {
      res.status(400).json({ error: 'Signature is required' });
      return;
    }

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Verify the Ethereum signature
    if (!verifyEthereumSignature(ethereumAddress, message, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    
    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);
    
    const user = await findOrCreateUser({
      ethereumAddress,
      name
    }, currentUserId);
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('Ethereum login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Ethereum' });
  }
});

// ORCID OAuth callback endpoint
router.post('/login/orcid', async (req, res): Promise<void> => {
  try {
    const { orcidId, accessToken, name, email } = req.body;
    
    if (!orcidId) {
      res.status(400).json({ error: 'ORCID ID is required' });
      return;
    }

    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);
    
    const user = await findOrCreateUser({
      orcidId,
      email,
      name
    }, currentUserId);
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('ORCID login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with ORCID' });
  }
});

// GitHub OAuth callback endpoint
router.post('/login/github', async (req, res): Promise<void> => {
  try {
    const { githubHandle, accessToken, name, email } = req.body;
    
    if (!githubHandle) {
      res.status(400).json({ error: 'GitHub handle is required' });
      return;
    }

    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);
    
    const user = await findOrCreateUser({
      githubHandle,
      email,
      name
    }, currentUserId);
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('GitHub login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with GitHub' });
  }
});

// BitBucket OAuth callback endpoint
router.post('/login/bitbucket', async (req, res): Promise<void> => {
  try {
    const { bitbucketHandle, accessToken, name, email } = req.body;
    
    if (!bitbucketHandle) {
      res.status(400).json({ error: 'BitBucket handle is required' });
      return;
    }

    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);
    
    const user = await findOrCreateUser({
      bitbucketHandle,
      email,
      name
    }, currentUserId);
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('BitBucket login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with BitBucket' });
  }
});

// GitLab OAuth callback endpoint
router.post('/login/gitlab', async (req, res): Promise<void> => {
  try {
    const { gitlabHandle, accessToken, name, email } = req.body;
    
    if (!gitlabHandle) {
      res.status(400).json({ error: 'GitLab handle is required' });
      return;
    }

    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);
    
    const user = await findOrCreateUser({
      gitlabHandle,
      email,
      name
    }, currentUserId);
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('GitLab login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with GitLab' });
  }
});

// Logout endpoint
router.post('/logout', async (req, res): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    
    // Delete the session
    await prisma.session.deleteMany({
      where: { token }
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user endpoint
router.get('/me', async (req, res): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    
    // Find session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });
    
    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    
    res.json({ user: session.user });
  } catch (error: any) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to get current user' });
  }
});

// TODO@P3: Do we need both this .get handler and the .post handler?
// OAuth callback endpoints for secure token exchange
// GET route for OAuth provider redirects
router.get('/:provider/callback', async (req, res): Promise<void> => {
  const { provider } = req.params;
  const { code, token } = req.query as unknown as {code: string, token?: string};

  try {
    console.log(`=== OAuth Callback for ${provider} ===`);
    console.log('Request details:', {
      provider,
      code: code ? `${code.substring(0, 10)}...` : 'null',
      codeLength: code ? code.length : 0,
      fullCode: code, // For debugging - remove in production
      bodyKeys: Object.keys(req.body),
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        origin: req.headers.origin,
        authorization: req.headers.authorization ? 'present' : 'missing'
      }
    });
    
    if (!code) {
      console.error('No authorization code provided');
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    // Check for duplicate requests and cached results
    const requestKey = `${provider}:${code}`;
    
    // First check if we have a cached result for this exact request
    if (oauthResultCache.has(requestKey)) {
      console.log('Returning cached OAuth result for duplicate request:', requestKey);
      const cachedResult = oauthResultCache.get(requestKey);
      res.json(cachedResult);
      return;
    }
    
    // Check if the same request is currently in progress
    if (ongoingOAuthRequests.has(requestKey)) {
      console.log('Duplicate OAuth request detected, rejecting to avoid API errors:', requestKey);
      res.status(429).json({ error: 'OAuth request already processing, please wait' });
      return;
    }
    
    // Mark request as ongoing
    ongoingOAuthRequests.set(requestKey, Date.now());
    
    // Clean up the request tracking after completion (with timeout)
    const cleanup = () => {
      ongoingOAuthRequests.delete(requestKey);
      // Also clean up cache after 5 minutes
      setTimeout(() => {
        oauthResultCache.delete(requestKey);
      }, 5 * 60 * 1000);
    };
    setTimeout(cleanup, 30000); // Cleanup after 30 seconds regardless

    let userData: UserData;
    
    switch (provider) {
      case 'github':
        console.log('Calling GitHub OAuth handler...');
        userData = await handleGitHubOAuth(code);
        break;
      case 'orcid':
        console.log('Calling ORCID OAuth handler...');
        userData = await handleORCIDOAuth(code);
        break;
      case 'bitbucket':
        console.log('Calling BitBucket OAuth handler...');
        userData = await handleBitBucketOAuth(code);
        break;
      case 'gitlab':
        console.log('Calling GitLab OAuth handler...');
        userData = await handleGitLabOAuth(code);
        break;
      default:
        console.error('Unsupported OAuth provider:', provider);
        res.status(400).json({ error: 'Unsupported OAuth provider' });
        return;
    }

    console.log('OAuth handler completed, user data:', {
      provider,
      userData: {
        ...userData,
        // Redact sensitive info in logs
        email: userData.email ? '***@***.***' : null,
        name: userData.name || null
      }
    });

    // Get current user ID from token (either from query param or authorization header)
    let currentUserId: number | null = null;
    if (token) {
      // Token provided in query parameter (from OAuth redirect)
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true }
      });
      if (session && session.expiresAt > new Date()) {
        currentUserId = session.user.id;
      }
    } else {
      // Fallback to authorization header
      currentUserId = await getCurrentUserFromToken(req);
    }
    
    // Use the existing login logic
    const user = await findOrCreateUser(userData, currentUserId);
    
    // If user was already authenticated, don't create a new session
    let session;
    if (currentUserId !== null) {
      // User was already authenticated, find their existing session
      const existingSession = await prisma.session.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      });
      if (existingSession && existingSession.expiresAt > new Date()) {
        session = existingSession;
      } else {
        session = await createSession(user.id);
      }
    } else {
      // New user, create a new session
      session = await createSession(user.id);
    }
    
    console.log('User created/found and session created successfully');
    
    // Prepare the response
    const response = {
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    };
    
    // Cache the successful result
    oauthResultCache.set(requestKey, response);
    
    // Clean up request tracking on success
    cleanup();
    
    // Redirect to frontend with success message
    const frontendUrl = `${process.env.FRONTEND_URL}/auth/${provider}/callback?code=${code}`;
    res.redirect(frontendUrl);
  } catch (error: any) {
    console.error(`=== ${req.params.provider} OAuth Error ===`);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Clean up request tracking on error
    if (req.body.code) {
      const requestKey = `${req.params.provider}:${req.body.code}`;
      ongoingOAuthRequests.delete(requestKey);
    }
    
    res.status(500).json({ 
      error: `Failed to authenticate with ${req.params.provider}`,
      details: error.message 
    });
  }
});

// OAuth handler functions
async function handleGitHubOAuth(code: string): Promise<UserData> {
  console.log('=== GitHub OAuth Handler ===');
  console.log('Code received:', {
    code: code ? `${code.substring(0, 10)}...` : 'null',
    codeLength: code ? code.length : 0,
    fullCode: code // Log full code for debugging
  });
  
  const requestBody = {
    client_id: process.env.GITHUB_CLIENT_ID!,
    client_secret: process.env.GITHUB_CLIENT_SECRET!,
    code: code,
    redirect_uri: `${process.env.API_URL}/api/auth/github/callback`,
  };
  
  console.log('GitHub token exchange request:', {
    url: 'https://github.com/login/oauth/access_token',
    client_id: requestBody.client_id,
    redirect_uri: requestBody.redirect_uri,
    code_preview: code ? `${code.substring(0, 10)}...` : 'null',
    frontend_url: process.env.FRONTEND_URL
  });

  // Exchange code for access token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await tokenResponse.text();
  console.log('GitHub token response:', {
    status: tokenResponse.status,
    statusText: tokenResponse.statusText,
    headers: Object.fromEntries(tokenResponse.headers.entries()),
    body: responseText
  });

  if (!tokenResponse.ok) {
    console.error('GitHub token exchange failed:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      body: responseText
    });
    throw new Error(`Failed to exchange code for GitHub access token: ${tokenResponse.status} ${tokenResponse.statusText} - ${responseText}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    console.error('Failed to parse GitHub token response as JSON:', parseError);
    throw new Error(`Invalid JSON response from GitHub: ${responseText}`);
  }
  
  if (tokenData.error) {
    console.error('GitHub OAuth token error:', tokenData);
    throw new Error(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  console.log('GitHub token exchange successful:', {
    access_token: tokenData.access_token ? 'present' : 'missing',
    token_type: tokenData.token_type,
    scope: tokenData.scope
  });
  // Get user data from GitHub API
  console.log('Fetching user data from GitHub API...');
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  console.log('GitHub user API response:', {
    status: userResponse.status,
    statusText: userResponse.statusText,
    ok: userResponse.ok
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    console.error('GitHub user API error response:', {
      status: userResponse.status,
      statusText: userResponse.statusText,
      body: errorText,
      headers: Object.fromEntries(userResponse.headers.entries())
    });
    throw new Error(`Failed to fetch GitHub user data: ${userResponse.status} ${userResponse.statusText} - ${errorText}`);
  }

  const userData: any = await userResponse.json();
  
  return {
    githubHandle: userData.login,
    name: userData.name,
    email: userData.email,
  };
}

async function handleORCIDOAuth(code: string): Promise<UserData> {
  console.log('=== ORCID OAuth Handler ===');
  console.log('Code received:', {
    code: code ? `${code.substring(0, 10)}...` : 'null',
    codeLength: code ? code.length : 0,
    fullCode: code // Log full code for debugging
  });

  // Use sandbox domain for development/testing
  const orcidDomain = process.env.ORCID_DOMAIN || 'orcid.org';
  const tokenUrl = `https://${orcidDomain}/oauth/token`;
  
  const requestBody = {
    client_id: process.env.ORCID_CLIENT_ID!,
    client_secret: process.env.ORCID_CLIENT_SECRET!,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: `${process.env.API_URL}/api/auth/orcid/callback`,
  };
  
  console.log('ORCID token exchange request:', {
    url: tokenUrl,
    client_id: requestBody.client_id,
    redirect_uri: requestBody.redirect_uri,
    code_preview: code ? `${code.substring(0, 10)}...` : 'null',
    orcid_domain: orcidDomain
  });

  // Exchange code for access token
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(requestBody),
  });

  const responseText = await tokenResponse.text();
  console.log('ORCID token response:', {
    status: tokenResponse.status,
    statusText: tokenResponse.statusText,
    headers: Object.fromEntries(tokenResponse.headers.entries()),
    body: responseText
  });

  if (!tokenResponse.ok) {
    console.error('ORCID token exchange failed:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      body: responseText
    });
    throw new Error(`Failed to exchange code for ORCID access token: ${tokenResponse.status} ${tokenResponse.statusText} - ${responseText}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    console.error('Failed to parse ORCID token response as JSON:', parseError);
    throw new Error(`Invalid JSON response from ORCID: ${responseText}`);
  }
  
  if (tokenData.error) {
    console.error('ORCID OAuth token error:', tokenData);
    throw new Error(`ORCID OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  console.log('ORCID token exchange successful:', {
    access_token: tokenData.access_token ? 'present' : 'missing',
    token_type: tokenData.token_type,
    scope: tokenData.scope,
    orcid: tokenData.orcid || 'not provided'
  });

  // // Get user data from ORCID API
  // console.log('Fetching user data from ORCID API...');
  // const userResponse = await fetch(`https://${orcidDomain}/v3.0/${tokenData.orcid}/person`, {
  //   headers: {
  //     'Authorization': `Bearer ${tokenData.access_token}`,
  //     'Accept': 'application/json',
  //   },
  // });

  // console.log('ORCID user API response:', {
  //   status: userResponse.status,
  //   statusText: userResponse.statusText,
  //   ok: userResponse.ok
  // });

  // if (!userResponse.ok) {
  //   const errorText = await userResponse.text();
  //   console.error('ORCID user API error response:', {
  //     status: userResponse.status,
  //     statusText: userResponse.statusText,
  //     body: errorText,
  //     headers: Object.fromEntries(userResponse.headers.entries())
  //   });
  //   throw new Error(`Failed to fetch ORCID user data: ${userResponse.status} ${userResponse.statusText} - ${errorText}`);
  // }

  // const userData: any = await userResponse.json();
  // console.log('ORCID user data received:', {
  //   orcid: tokenData.orcid,
  //   has_person: !!userData,
  //   name_given: userData?.name?.['given-names']?.value || 'not provided',
  //   name_family: userData?.name?.['family-name']?.value || 'not provided'
  // });
  
  return {
    orcidId: tokenData.orcid,
    // name: userData?.name ? `${userData.name['given-names']?.value || ''} ${userData.name['family-name']?.value || ''}`.trim() : undefined,
  };
}

async function handleBitBucketOAuth(code: string): Promise<UserData> {
  // Exchange code for access token
  const tokenResponse = await fetch('https://bitbucket.org/site/oauth2/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: process.env.BITBUCKET_CLIENT_ID!,
      client_secret: process.env.BITBUCKET_CLIENT_SECRET!,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to exchange code for BitBucket access token');
  }

  const tokenData: any = await tokenResponse.json();
  
  if (tokenData.error) {
    throw new Error(`BitBucket OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  // Get user data from BitBucket API
  const userResponse = await fetch('https://api.bitbucket.org/2.0/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    throw new Error('Failed to fetch BitBucket user data');
  }

  const userData: any = await userResponse.json();
  
  return {
    bitbucketHandle: userData.username,
    name: userData.display_name,
    email: userData.email,
  };
}

async function handleGitLabOAuth(code: string): Promise<UserData> {
  console.log('=== GitLab OAuth Handler ===');
  console.log('Code received:', {
    code: code ? `${code.substring(0, 10)}...` : 'null',
    codeLength: code ? code.length : 0,
    fullCode: code // Log full code for debugging
  });
  
  const requestBody = {
    client_id: process.env.GITLAB_CLIENT_ID!,
    client_secret: process.env.GITLAB_CLIENT_SECRET!,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: `${process.env.API_URL}/api/auth/gitlab/callback`,
  };
  
  console.log('GitLab token exchange request:', {
    url: 'https://gitlab.com/oauth/token',
    client_id: requestBody.client_id,
    redirect_uri: requestBody.redirect_uri,
    code_preview: code ? `${code.substring(0, 10)}...` : 'null'
  });

  // Exchange code for access token
  const tokenResponse = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(requestBody),
  });

  const responseText = await tokenResponse.text();
  console.log('GitLab token response:', {
    status: tokenResponse.status,
    statusText: tokenResponse.statusText,
    headers: Object.fromEntries(tokenResponse.headers.entries()),
    body: responseText
  });

  if (!tokenResponse.ok) {
    console.error('GitLab token exchange failed:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      body: responseText
    });
    throw new Error(`Failed to exchange code for GitLab access token: ${tokenResponse.status} ${tokenResponse.statusText} - ${responseText}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    console.error('Failed to parse GitLab token response as JSON:', parseError);
    throw new Error(`Invalid JSON response from GitLab: ${responseText}`);
  }
  
  if (tokenData.error) {
    console.error('GitLab OAuth token error:', tokenData);
    throw new Error(`GitLab OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  console.log('GitLab token exchange successful:', {
    access_token: tokenData.access_token ? 'present' : 'missing',
    token_type: tokenData.token_type,
    scope: tokenData.scope
  });

  // Get user data from GitLab API
  console.log('Fetching user data from GitLab API...');
  const userResponse = await fetch('https://gitlab.com/oauth/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  console.log('GitLab user API response:', {
    status: userResponse.status,
    statusText: userResponse.statusText,
    ok: userResponse.ok
  });

  if (!userResponse.ok) {
    const errorText = await userResponse.text();
    console.error('GitLab user API error response:', {
      status: userResponse.status,
      statusText: userResponse.statusText,
      body: errorText,
      headers: Object.fromEntries(userResponse.headers.entries())
    });
    throw new Error(`Failed to fetch GitLab user data: ${userResponse.status} ${userResponse.statusText} - ${errorText}`);
  }

  const userData: any = await userResponse.json();
  console.log('GitLab user data received:', {
    id: userData.sub,
    username: userData.nickname,
    name: userData.name,
    email: userData.email ? 'present' : 'not provided'
  });
  
  return {
    gitlabHandle: userData.username,
    name: userData.name,
    email: userData.email,
  };
}

// Disconnect provider endpoint
router.post('/disconnect/:provider', async (req, res): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const { provider } = req.params;
    
    // Find session and get user
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });
    
    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = session.user;
    
    // Determine which field to clear based on provider
    const providerFields: Record<string, string> = {
      ethereum: 'ethereumAddress',
      orcid: 'orcidId',
      github: 'githubHandle', 
      bitbucket: 'bitbucketHandle',
      gitlab: 'gitlabHandle'
    };

    const fieldToClear = providerFields[provider];
    if (!fieldToClear) {
      res.status(400).json({ error: 'Invalid provider' });
      return;
    }

    // Check if the provider is actually connected
    if (!(user as any)[fieldToClear]) {
      res.status(400).json({ error: 'Provider not connected' });
      return;
    }

    // Update user to remove the provider connection
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        [fieldToClear]: null
      }
    });
    
    res.json({ 
      message: `${provider} disconnected successfully`,
      user: updatedUser 
    });
  } catch (error: any) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect provider' });
  }
});

// Cleanup expired sessions (should be called periodically)
router.delete('/sessions/cleanup', async (req, res) => {
  try {
    const deletedSessions = await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });
    
    res.json({ 
      message: 'Expired sessions cleaned up', 
      deletedCount: deletedSessions.count 
    });
  } catch (error: any) {
    console.error('Session cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup sessions' });
  }
});

export default router;

