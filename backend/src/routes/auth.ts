import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { getCurrentUserFromToken } from '../middleware/auth.js';
import EmailService from '../services/EmailService.js';

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
  issuingState?: string;
  personalNumber?: string;
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
  const { email, name, ethereumAddress, orcidId, githubHandle, bitbucketHandle, gitlabHandle, issuingState, personalNumber } = userData;
  // First, check for exact matches using unique fields
  const searchConditions: UserData[] = [];
  if (email) searchConditions.push({ email });
  if (ethereumAddress) searchConditions.push({ ethereumAddress });
  if (orcidId) searchConditions.push({ orcidId });
  if (githubHandle) searchConditions.push({ githubHandle });
  if (bitbucketHandle) searchConditions.push({ bitbucketHandle });
  if (gitlabHandle) searchConditions.push({ gitlabHandle });
  if (issuingState && personalNumber) searchConditions.push({ issuingState, personalNumber });

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
          issuingState: issuingState || currentUser.issuingState,
          personalNumber: personalNumber || currentUser.personalNumber,
        }
      });
    } else {
      // No current user, create new one
      const createData: any = {};
      if (name) createData.name = name;
      if (ethereumAddress) createData.ethereumAddress = ethereumAddress;
      if (orcidId) createData.orcidId = orcidId;
      if (githubHandle) createData.githubHandle = githubHandle;
      if (bitbucketHandle) createData.bitbucketHandle = bitbucketHandle;
      if (gitlabHandle) createData.gitlabHandle = gitlabHandle;
      if (email) createData.email = email;
      if (issuingState) createData.issuingState = issuingState;
      if (personalNumber) createData.personalNumber = personalNumber;
      
      return await prisma.user.create({
        data: createData
      });
    }
  } else {
    // One user found, update with new information
    if (currentUserId !== null && currentUserId !== existingUser.id) {
      // Get the current user to check for conflicting KYC data
      const currentUser = await prisma.user.findUnique({
        where: { id: currentUserId }
      });
      
      if (!currentUser) {
        throw new Error('Current user not found');
      }
      
      // Check if users have different (issuingState, personalNumber) - don't allow merge
      const existingKycData = existingUser.issuingState && existingUser.personalNumber 
        ? { issuingState: existingUser.issuingState, personalNumber: existingUser.personalNumber }
        : null;
      const currentKycData = currentUser.issuingState && currentUser.personalNumber 
        ? { issuingState: currentUser.issuingState, personalNumber: currentUser.personalNumber }
        : null;
      
      if (existingKycData && currentKycData && 
          (existingKycData.issuingState !== currentKycData.issuingState || 
           existingKycData.personalNumber !== currentKycData.personalNumber)) {
        throw new Error('Cannot merge users with different KYC data (issuingState, personalNumber)');
      }
      
      const updateData: any = {};
      if (email || existingUser.email) updateData.email = email || existingUser.email;
      if (name || existingUser.name) updateData.name = name || existingUser.name;
      if (ethereumAddress || existingUser.ethereumAddress) updateData.ethereumAddress = ethereumAddress || existingUser.ethereumAddress;
      if (orcidId || existingUser.orcidId) updateData.orcidId = orcidId || existingUser.orcidId;
      if (githubHandle || existingUser.githubHandle) updateData.githubHandle = githubHandle || existingUser.githubHandle;
      if (bitbucketHandle || existingUser.bitbucketHandle) updateData.bitbucketHandle = bitbucketHandle || existingUser.bitbucketHandle;
      if (gitlabHandle || existingUser.gitlabHandle) updateData.gitlabHandle = gitlabHandle || existingUser.gitlabHandle;
      if (issuingState || existingUser.issuingState) updateData.issuingState = issuingState || existingUser.issuingState;
      if (personalNumber || existingUser.personalNumber) updateData.personalNumber = personalNumber || existingUser.personalNumber;
      
      // If there's a current user that's different from the existing user,
      // merge the existing user's data into the current user and delete the existing user.
      return await prisma.$transaction(async (tx) => {
        // Handle bannedTill - use the more restrictive ban (later date)
        if (existingUser.bannedTill && currentUser.bannedTill) {
          updateData.bannedTill = existingUser.bannedTill > currentUser.bannedTill 
            ? existingUser.bannedTill 
            : currentUser.bannedTill;
        } else if (existingUser.bannedTill) {
          updateData.bannedTill = existingUser.bannedTill;
        }
        
        // Transfer related data from existing user to current user
        // Transfer sessions
        await tx.session.updateMany({
          where: { userId: existingUser.id },
          data: { userId: currentUserId }
        });
        
        // Transfer gas token distributions
        await tx.gasTokenDistribution.updateMany({
          where: { userId: existingUser.id },
          data: { userId: currentUserId }
        });
        
        // Transfer OpenAI logs
        await tx.openAILog.updateMany({
          where: { userId: existingUser.id },
          data: { userId: currentUserId }
        });
        
        // Transfer email verification tokens
        await tx.emailVerificationToken.updateMany({
          where: { userId: existingUser.id },
          data: { userId: currentUserId }
        });
        
        // Delete the existing user (this will cascade delete any remaining related data)
        await tx.user.delete({where: {id: existingUser.id}});
        
        // Update the current user with merged data
        return await tx.user.update({
          where: { id: currentUserId },
          data: updateData
        });
      });
    } else {
      // Either no current user or current user is the same as existing user
      const updateData: any = {};
      if (email || existingUser.email) updateData.email = email || existingUser.email;
      if (name || existingUser.name) updateData.name = name || existingUser.name;
      if (ethereumAddress || existingUser.ethereumAddress) updateData.ethereumAddress = ethereumAddress || existingUser.ethereumAddress;
      if (orcidId || existingUser.orcidId) updateData.orcidId = orcidId || existingUser.orcidId;
      if (githubHandle || existingUser.githubHandle) updateData.githubHandle = githubHandle || existingUser.githubHandle;
      if (bitbucketHandle || existingUser.bitbucketHandle) updateData.bitbucketHandle = bitbucketHandle || existingUser.bitbucketHandle;
      if (gitlabHandle || existingUser.gitlabHandle) updateData.gitlabHandle = gitlabHandle || existingUser.gitlabHandle;
      if (issuingState || existingUser.issuingState) updateData.issuingState = issuingState || existingUser.issuingState;
      if (personalNumber || existingUser.personalNumber) updateData.personalNumber = personalNumber || existingUser.personalNumber;
      
      return await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData
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

// Email registration endpoint
router.post('/register/email', async (req, res): Promise<void> => {
  try {
    const { email, name } = req.body;
    
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    // Validate email format
    // In development mode, allow @localhost emails for testing
    const isDevelopment = process.env.NODE_ENV === 'development';
    const emailRegex = isDevelopment 
      ? /^[^\s@]+@(localhost|127\.0\.0\.1|[\w.-]+\.[\w.-]+)$/
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // Get current user ID from token if present (for connecting additional accounts)
    const currentUserId = await getCurrentUserFromToken(req);
    
    // Check if email is already taken by another user (only if verified)
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser && existingUser.emailVerified && (!currentUserId || existingUser.id !== currentUserId)) {
      res.status(400).json({ error: 'Email is already registered and verified' });
      return;
    }

    let user;
    if (currentUserId && existingUser && existingUser.id === currentUserId) {
      // User is already authenticated and this is their email, just send verification
      user = existingUser;
    } else if (currentUserId) {
      // User is authenticated and wants to add this email to their account
      user = await prisma.user.update({
        where: { id: currentUserId },
        data: { email, name: name || undefined }
      });
    } else {
      // New user registration
      user = await findOrCreateUser({
        email,
        name
      }, null);
    }

    // Generate verification token and send email
    const verificationToken = EmailService.generateVerificationToken();
    console.log('About to send verification email for:', email, 'user:', user.id, 'token:', verificationToken);
    const emailSent = await EmailService.sendVerificationEmail(email, verificationToken, user.id);

    if (!emailSent) {
      res.status(500).json({ error: 'Failed to send verification email' });
      return;
    }

    // If user is already authenticated, return success immediately
    if (currentUserId) {
      const responseMessage = 'Verification email sent successfully';
      
      res.json({
        message: responseMessage,
        user: {
          ...user,
          emailVerified: false // Will be true after verification
        }
      });
      return;
    }

    // For new users, create a temporary session that requires email verification
    const session = await createSession(user.id);
    
    const responseMessage = 'Registration successful. Please check your email to verify your account.';
    
    res.json({
      message: responseMessage,
      user: {
        ...user,
        emailVerified: false
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      },
      requiresVerification: true
    });
  } catch (error: any) {
    console.error('Email registration error:', error);
    res.status(500).json({ error: 'Failed to register with email' });
  }
});

// Email verification endpoint
router.post('/verify/email', async (req, res): Promise<void> => {
  try {
    const { token } = req.body;
    
    if (!token) {
      res.status(400).json({ error: 'Verification token is required' });
      return;
    }

    const result = await EmailService.verifyEmailToken(token);
    
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Get the updated user data
    const user = await prisma.user.findUnique({
      where: { id: result.userId! }
    });

    res.json({
      message: 'Email verified successfully',
      user
    });
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Resend verification email endpoint
router.post('/resend-verification', async (req, res): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    
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
    
    if (!user.email) {
      res.status(400).json({ error: 'No email address associated with this account' });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: 'Email is already verified' });
      return;
    }

    // Generate new verification token and send email
    const verificationToken = EmailService.generateVerificationToken();
    const emailSent = await EmailService.sendVerificationEmail(user.email, verificationToken, user.id);

    if (!emailSent) {
      res.status(500).json({ error: 'Failed to send verification email' });
      return;
    }

    res.json({
      message: 'Verification email sent successfully'
    });
  } catch (error: any) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
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

// Get KYC status endpoint
router.get('/kyc/status', async (req, res): Promise<void> => {
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
    
    const user = session.user;
    
    res.json({
      kycStatus: user.kycStatus,
      kycVerifiedAt: user.kycVerifiedAt,
      kycRejectedAt: user.kycRejectedAt,
      kycRejectionReason: user.kycRejectionReason,
      issuingState: user.issuingState,
      personalNumber: user.personalNumber
    });
  } catch (error: any) {
    console.error('Get KYC status error:', error);
    res.status(500).json({ error: 'Failed to get KYC status' });
  }
});

// TODO@P3: Do we need both this .get handler and the .post handler?
// OAuth callback endpoints for secure token exchange
// GET route for OAuth provider redirects
router.get('/:provider/callback', async (req, res): Promise<void> => {
  const { provider } = req.params;
  const { code, state } = req.query as unknown as {code: string, state?: string};

  try {
    console.log(`=== OAuth Callback for ${provider} ===`);
    console.log('Request details:', {
      provider,
      code: code ? `${code.substring(0, 10)}...` : 'null',
      codeLength: code ? code.length : 0,
      fullCode: code, // For debugging - remove in production
      state: state ? `${state.substring(0, 10)}...` : 'null',
      stateLength: state ? state.length : 0,
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
        // name: userData.name || null
      }
    });

    // Get current user ID from state parameter (OAuth state) or authorization header
    let currentUserId: number | null = null;
    if (state) {
      // Token provided in state parameter (from OAuth redirect)
      const session = await prisma.session.findUnique({
        where: { token: state },
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
    if (code) {
      const requestKey = `${req.params.provider}:${code}`;
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
    // name: userData.name,
    // email: userData.email,
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
    // name: userData.display_name,
    // email: userData.email,
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
    // name: userData.name,
    // email: userData.email,
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
    
    // Handle KYC disconnection specially
    if (provider === 'kyc') {
      if (user.kycStatus !== 'APPROVED') {
        res.status(400).json({ error: 'KYC not verified' });
        return;
      }
      
      // Clear all KYC-related fields
      const updateData = {
        kycStatus: null,
        kycVerifiedAt: null,
        kycRejectedAt: null,
        kycRejectionReason: null,
        issuingState: null,
        personalNumber: null
      };
      
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });
      
      res.json({ 
        message: 'KYC disconnected successfully',
        user: updatedUser 
      });
      return;
    }

    // Determine which field to clear based on provider
    const providerFields: Record<string, string> = {
      ethereum: 'ethereumAddress',
      orcid: 'orcidId',
      github: 'githubHandle', 
      bitbucket: 'bitbucketHandle',
      gitlab: 'gitlabHandle',
      email: 'email'
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
    const updateData: any = {
      [fieldToClear]: null
    };
    
    // If disconnecting email, also clear emailVerified
    if (provider === 'email') {
      updateData.emailVerified = false;
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData
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

// Didit KYC callback endpoint with webhook signature verification
router.post('/kyc/didit/callback', async (req, res): Promise<void> => {
  try {
    // Get the raw request body for signature verification
    const rawBody = req.body;
    const rawBodyString = (req as any).rawBody;
    
    // Get headers for signature verification
    const signature = req.get('X-Signature');
    const timestamp = req.get('X-Timestamp');
    const webhookSecretKey = process.env.DIDIT_WEBHOOK_KEY;
    
    // Ensure all required data is present
    if (!signature || !timestamp || !webhookSecretKey) {
      console.error('Missing required webhook verification data');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    
    // Validate the timestamp to ensure the request is fresh (within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const incomingTime = parseInt(timestamp, 10);
    if (Math.abs(currentTime - incomingTime) > 300) {
      console.error('Request timestamp is stale');
      res.status(401).json({ message: 'Request timestamp is stale.' });
      return;
    }
    
    // Generate an HMAC from the raw body using the shared secret
    const hmac = crypto.createHmac('sha256', webhookSecretKey);
    const expectedSignature = hmac.update(rawBodyString).digest('hex');
    
    // Compare using timingSafeEqual for security
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');
    const providedSignatureBuffer = Buffer.from(signature, 'utf8');
    
    if (
      expectedSignatureBuffer.length !== providedSignatureBuffer.length ||
      !crypto.timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer)
    ) {
      console.error(`Invalid signature. Computed (${expectedSignature}), Provided (${signature})`);
      res.status(401).json({
        message: `Invalid signature. Computed (${expectedSignature}), Provided (${signature})`,
      });
      return;
    }
    
    // Signature is valid, proceed with processing
    console.log('Didit KYC callback received and verified:', rawBody);
    
    const { session_id, status, webhook_type, vendor_data, decision, aml } = rawBody;
    
    if (!session_id) {
      console.error('No session_id in Didit callback');
      res.status(400).json({ error: 'session_id is required' });
      return;
    }
    
    // Find the session by session_id from metadata (vendor_data is INSTALLATION_UID)
    let session;
    let user;
    
    // The session_id should be in the metadata from the Didit callback
    const metadata = rawBody.metadata;
    const sessionId = metadata?.session_id;
    
    if (sessionId) {
      // Find the session by session ID
      session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true }
      });
      if (session) {
        user = session.user;
      }
    }
    
    if (!user) {
      console.log('Session not found, creating new user for KYC webhook:', {
        session_id,
        vendor_data,
        sessionId,
        webhook_type,
        status
      });
      
      // Create a new user for this KYC session
      const kycData = decision?.id_verification;
      let userName = 'KYC User';
      let userEmail = null;
      
      // Extract user information from KYC data if available
      if (kycData) {
        if (kycData.first_name && kycData.last_name) {
          userName = `${kycData.first_name} ${kycData.last_name}`.trim();
        } else if (kycData.first_name) {
          userName = kycData.first_name;
        } else if (kycData.last_name) {
          userName = kycData.last_name;
        }
        
        if (kycData.email) {
          userEmail = kycData.email;
        }
      }
      
      // Create new user
      user = await prisma.user.create({
        data: {
          name: userName,
          email: userEmail,
          ethereumAddress: null,
          orcidId: null,
          githubHandle: null,
          bitbucketHandle: null,
          gitlabHandle: null,
          onboarded: false,
          kycStatus: 'PENDING'
        } as any
      });
      
      // Create a new session for this user
      session = await createSession(user.id);
      
      console.log('Created new user and session for KYC webhook:', {
        userId: user.id,
        sessionId: session.id,
        originalSessionId: sessionId,
        userName,
        userEmail
      });
    }
    
    // Update user KYC status based on Didit response
    const updateData: any = {
      kycStatus: status?.toUpperCase() || 'UNKNOWN'
    };
    
    // Handle different statuses according to Didit webhook format
    if (status === 'Approved' && !aml || aml.status === 'Approved') {
      updateData.kycVerifiedAt = new Date();
      updateData.kycRejectedAt = null;
      updateData.kycRejectionReason = null;
      
      // Store additional verification data if available
      if (decision && decision.id_verification) {
        const idData = decision.id_verification;
        
        // Store user name from KYC verification data
        if (idData.first_name && idData.last_name) {
          updateData.name = `${idData.first_name} ${idData.last_name}`.trim();
        } else if (idData.first_name) {
          updateData.name = idData.first_name;
        } else if (idData.last_name) {
          updateData.name = idData.last_name;
        }
        
        // Extract and store KYC fields for user identification
        if (idData.issuing_state && idData.document_number) {
          updateData.issuingState = idData.issuing_state;
          updateData.personalNumber = idData.document_number;
        }
        
        updateData.kycData = JSON.stringify({
          documentType: idData.document_type,
          documentNumber: idData.document_number,
          firstName: idData.first_name,
          lastName: idData.last_name,
          dateOfBirth: idData.date_of_birth,
          nationality: idData.nationality,
          issuingState: idData.issuing_state,
          expirationDate: idData.expiration_date
        });
      }
    } else if (status === 'Declined' || aml.status === 'Rejected') {
      updateData.kycRejectedAt = new Date();
      updateData.kycRejectionReason = 'Verification declined by Didit';
      updateData.kycVerifiedAt = null;
      
      // Store rejection details if available
      let rejectionReason = 'Verification declined by Didit';
      if (decision && decision.reviews && decision.reviews.length > 0) {
        const review = decision.reviews[0];
        rejectionReason = review.comment || 'Verification declined by Didit';
        updateData.kycRejectionReason = rejectionReason;
      }
      
      // Send OFAC report for declined/rejected KYC
      try {
        const kycData = decision?.id_verification ? {
          documentType: decision.id_verification.document_type,
          documentNumber: decision.id_verification.document_number,
          firstName: decision.id_verification.first_name,
          lastName: decision.id_verification.last_name,
          dateOfBirth: decision.id_verification.date_of_birth,
          nationality: decision.id_verification.nationality,
          issuingState: decision.id_verification.issuing_state,
          personalNumber: decision.id_verification.document_number
        } : null;
        
        const emailSent = await EmailService.sendOFACReport(user, kycData, aml, rejectionReason);
        if (emailSent) {
          console.log('OFAC report sent successfully for user:', user.id);
        } else {
          console.error('Failed to send OFAC report for user:', user.id);
        }
      } catch (emailError) {
        console.error('Error sending OFAC report:', emailError);
        // Don't fail the entire KYC callback if email fails
      }
    } else if (status === 'In Review') {
      updateData.kycStatus = 'PENDING';
    } else if (status === 'Abandoned') {
      updateData.kycStatus = 'ABANDONED';
    }
    
    // Update user KYC status
    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });
    } catch (error: any) {
      // Handle unique constraint violation for KYC fields
      if (error.code === 'P2002' && error.meta?.target?.includes('issuingState')) {
        console.error('KYC combination already exists for another user:', {
          userId: user.id,
          issuingState: updateData.issuingState,
          personalNumber: updateData.personalNumber
        });
        res.status(409).json({ 
          error: 'This KYC combination is already associated with another user',
          kycStatus: 'DUPLICATE'
        });
        return;
      }
      throw error; // Re-throw if it's a different error
    }
    
    console.log('KYC status updated for user:', {
      userId: user.id,
      kycStatus: updateData.kycStatus,
      sessionId: session?.id,
      diditSessionId: session_id,
      webhookType: webhook_type,
      newUserCreated: !sessionId || session?.id !== sessionId,
      originalSessionId: sessionId
    });
    
    res.json({
      success: true,
      message: 'KYC status updated successfully',
      userId: user.id,
      kycStatus: updateData.kycStatus
    });
  } catch (error: any) {
    console.error('Didit KYC callback error:', error);
    res.status(500).json({ error: 'Failed to process KYC callback' });
  }
});

// KYC initiation endpoint
router.post('/kyc/initiate', async (req, res): Promise<void> => {
  try {
    let session;
    let user;
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // User is authenticated, use existing session
      const token = authHeader.substring(7);
      
      session = await prisma.session.findUnique({
        where: { token },
        include: { user: true }
      });
      
      if (!session || session.expiresAt < new Date()) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      
      user = session.user;
    } else {
      // User is not authenticated, create a temporary user and session for KYC
      user = await prisma.user.create({
        data: {
          // Create a minimal user record for KYC
          name: 'KYC User',
          email: null,
          ethereumAddress: null,
          orcidId: null,
          githubHandle: null,
          bitbucketHandle: null,
          gitlabHandle: null,
          onboarded: false,
          kycStatus: 'PENDING'
        } as any
      });
      
      // Create a session for this temporary user with extended expiration for KYC
      session = await createSession(user.id);
      
      // Extend session expiration for KYC process (30 days instead of 7)
      const extendedExpiresAt = new Date();
      extendedExpiresAt.setDate(extendedExpiresAt.getDate() + 30);
      
      session = await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: extendedExpiresAt }
      });
    }
    
    // Check if KYC should be skipped
    if (process.env.SKIP_KYC === 'true') {
      console.log('SKIP_KYC is enabled - setting KYC as passed for user:', user.id);
      
      // Update user KYC status to VERIFIED
      await prisma.user.update({
        where: { id: user.id },
        data: {
          kycStatus: 'APPROVED',
          kycVerifiedAt: new Date(),
          kycRejectedAt: null,
          kycRejectionReason: null,
          kycData: JSON.stringify({ skipped: true, reason: 'SKIP_KYC environment variable enabled' })
        } as any
      });

      const response: any = {
        url: null, // No external URL needed
        sessionId: null,
        skipped: true,
        message: 'KYC skipped - status set to VERIFIED'
      };
      
      // If user was not authenticated, include session token for frontend
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        response.session = {
          token: session.token,
          expiresAt: session.expiresAt
        };
        response.user = user;
      }
      
      res.json(response);
      return;
    }
    
    // Check environment variables
    if (!process.env.DIDIT_WORKFLOW_ID || !process.env.INSTALLATION_UID || !process.env.DIDIT_API_KEY) {
      res.status(500).json({ error: 'KYC service configuration missing' });
      return;
    }

    // Call Didit API to initiate KYC session
    const diditResponse = await fetch('https://verification.didit.me/v2/session/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.DIDIT_API_KEY
      },
        body: JSON.stringify({
          workflow_id: process.env.DIDIT_WORKFLOW_ID,
          vendor_data: process.env.INSTALLATION_UID,
          metadata: {
            session_id: session.id
          },
        })
    });

    if (!diditResponse.ok) {
      const errorText = await diditResponse.text();
      console.error('Didit API error:', {
        status: diditResponse.status,
        statusText: diditResponse.statusText,
        body: errorText
      });
      res.status(500).json({ error: 'Failed to initiate KYC session' });
      return;
    }

    const diditData: any = await diditResponse.json();
    
    if (!diditData.url) {
      console.error('Didit API response missing URL:', diditData);
      res.status(500).json({ error: 'Invalid response from KYC service' });
      return;
    }

    // Store KYC session info
    await prisma.user.update({
      where: { id: user.id },
      data: {
        kycStatus: 'PENDING'
      } as any
    });

    const response: any = {
      url: diditData.url,
      sessionId: diditData.session_id || null
    };
    
    // If user was not authenticated, include session token for frontend
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      response.session = {
        token: session.token,
        expiresAt: session.expiresAt
      };
      response.user = user;
    }
    
    res.json(response);
  } catch (error: any) {
    console.error('KYC initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate KYC verification' });
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

