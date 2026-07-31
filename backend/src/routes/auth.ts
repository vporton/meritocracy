import express from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { getCurrentUserFromToken } from '../middleware/auth.js';
import EmailService from '../services/EmailService.js';
import { isImmediateDeletionCandidate, makeUserSoftDeletePayload, softDeleteUser } from '../services/userDeletionUtils.js';
import { prisma } from '../lib/prisma.js';
import { normalizeEmail, syncPrimaryEmail } from '../services/userEmailUtils.js';
import { requireAdmin } from '../middleware/privilegedAuth.js';
import { fixedWindowRateLimit } from '../middleware/rateLimit.js';
import {
  createOpaqueToken,
  hashOpaqueToken,
  signOAuthState,
  timingSafeEqualString,
  verifyOAuthState,
  type OAuthProvider,
} from '../security/tokens.js';

const router = express.Router();
const challengeRateLimit = fixedWindowRateLimit({ name: 'ethereum-challenge', windowMs: 5 * 60_000, max: 20 });
const loginRateLimit = fixedWindowRateLimit({ name: 'login', windowMs: 5 * 60_000, max: 20 });
const emailRateLimit = fixedWindowRateLimit({ name: 'email-auth', windowMs: 15 * 60_000, max: 10 });
const oauthRateLimit = fixedWindowRateLimit({ name: 'oauth-start', windowMs: 10 * 60_000, max: 30 });
const kycRateLimit = fixedWindowRateLimit({ name: 'kyc-initiate', windowMs: 10 * 60_000, max: 10 });

function getLivelinessDueAt(verifiedAt: Date = new Date()): Date {
  const configuredMonths = Number.parseInt(process.env.DIDIT_LIVELINESS_INTERVAL_MONTHS || '3', 10);
  const intervalMonths = Number.isFinite(configuredMonths) && configuredMonths > 0 ? configuredMonths : 3;
  const dueAt = new Date(verifiedAt);
  dueAt.setMonth(dueAt.getMonth() + intervalMonths);
  return dueAt;
}

const ethereumVerificationClients = [
  createPublicClient({
    chain: mainnet,
    transport: http(),
  }),
  createPublicClient({
    chain: sepolia,
    transport: http(),
  }),
];

// Remove duplicate auth middleware - now imported from shared module

// Helper function to verify Ethereum signature
async function verifyEthereumSignature(address: string, message: string, signature: string): Promise<boolean> {
  const normalizedAddress = String(address).toLowerCase();

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    const normalizedRecovered = recoveredAddress.toLowerCase();
    return normalizedAddress === normalizedRecovered;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    for (const client of ethereumVerificationClients) {
      try {
        const isValid = await client.verifyMessage({
          address: address as Address,
          message,
          signature: signature as Hex,
        });

        if (isValid) {
          return true;
        }
      } catch (verificationError) {
        console.error(
          `Error verifying Ethereum signature on ${client.chain?.name ?? 'unknown chain'}:`,
          verificationError
        );
      }
    }

    console.error('Error verifying Ethereum signature:', errorMessage);
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
  residenceCountry?: string;
}

class IdentityConflictError extends Error {
  constructor() {
    super('This verified identity is already linked to another account');
    this.name = 'IdentityConflictError';
  }
}

const userWithEmailsInclude: Prisma.UserInclude = {
  emails: {
    orderBy: [
      { verified: 'desc' },
      { createdAt: 'asc' }
    ]
  }
};

const disconnectedAccountSelect: Prisma.UserSelect = {
  emailVerified: true,
  bannedTill: true,
  onboarded: true,
  isDeleted: true,
  kycStatus: true,
  kycVotingStatus: true,
  ethereumAddress: true,
  solanaAddress: true,
  bitcoinAddress: true,
  bitcoinCashAddress: true,
  polkadotAddress: true,
  cosmosAddress: true,
  stellarAddress: true,
  icpAddress: true,
  orcidId: true,
  githubHandle: true,
  bitbucketHandle: true,
  gitlabHandle: true
};

async function getUserWithEmails(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: userWithEmailsInclude
  });
}

async function maybeSoftDeleteDisconnectedAccount(tx: Prisma.TransactionClient, userId: number): Promise<boolean> {
  const candidate = await tx.user.findUnique({
    where: { id: userId },
    select: disconnectedAccountSelect
  });

  if (!candidate || !isImmediateDeletionCandidate(candidate)) {
    return false;
  }

  await softDeleteUser(tx, userId, {
    removeEmails: true,
    removeSessions: true
  });

  return true;
}

// Find or create only from provider-verified identity data. Linking an identity
// claimed by a different account is rejected rather than merging accounts.
async function findOrCreateUser(userData: UserData, currentUserId: number | null = null) {
  const { email, name, ethereumAddress, orcidId, githubHandle, bitbucketHandle, gitlabHandle, issuingState, personalNumber, residenceCountry } = userData;
  // First, check for exact matches using unique fields
  const searchConditions: Prisma.UserWhereInput[] = [];
  if (email) searchConditions.push({ email });
  if (ethereumAddress) searchConditions.push({ ethereumAddress: { equals: ethereumAddress, mode: 'insensitive' } });
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
          residenceCountry: residenceCountry || currentUser.residenceCountry,
        },
        include: userWithEmailsInclude
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
      if (residenceCountry) createData.residenceCountry = residenceCountry;

      return await prisma.user.create({
        data: createData,
        include: userWithEmailsInclude
      });
    }
  } else {
    // One user found, update with new information
    if (currentUserId !== null && currentUserId !== existingUser.id) {
      // Account linking must never merge or transfer another account's sessions,
      // financial history, KYC state, or votes merely because a provider identity
      // is already claimed.
      throw new IdentityConflictError();
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
      if (residenceCountry || existingUser.residenceCountry) updateData.residenceCountry = residenceCountry || existingUser.residenceCountry;

      return await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
        include: userWithEmailsInclude
      });
    }
  }
}

// Helper function to create session
async function createSession(userId: number) {
  const rawToken = createOpaqueToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

  const session = await prisma.session.create({
    data: {
      userId,
      token: hashOpaqueToken(rawToken),
      expiresAt
    }
  });

  return { ...session, token: rawToken };
}

router.post('/challenge/ethereum', challengeRateLimit, async (req, res): Promise<void> => {
  try {
    const rawAddress = typeof req.body?.ethereumAddress === 'string' ? req.body.ethereumAddress.trim() : '';
    if (!ethers.isAddress(rawAddress)) {
      res.status(400).json({ error: 'Valid Ethereum address is required' });
      return;
    }

    const address = ethers.getAddress(rawAddress).toLowerCase();
    const challengeId = createOpaqueToken(24);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const message = [
      'Sign in to Meritocracy',
      `Address: ${address}`,
      `Nonce: ${challengeId}`,
      `Expires at: ${expiresAt.toISOString()}`,
      'This request will not trigger a blockchain transaction.'
    ].join('\n');

    await prisma.ethereumAuthChallenge.create({
      data: { id: challengeId, address, message, expiresAt }
    });

    await prisma.ethereumAuthChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    });

    res.status(201).json({ challengeId, message, expiresAt });
  } catch (error) {
    console.error('Ethereum challenge creation failed:', error);
    res.status(500).json({ error: 'Failed to create authentication challenge' });
  }
});

// Ethereum login endpoint
router.post('/login/ethereum', loginRateLimit, async (req, res): Promise<void> => {
  try {
    const { ethereumAddress, signature, message, challengeId } = req.body;

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

    if (typeof challengeId !== 'string' || challengeId.length < 16 || !ethers.isAddress(ethereumAddress)) {
      res.status(400).json({ error: 'Valid authentication challenge is required' });
      return;
    }

    const normalizedAddress = ethers.getAddress(ethereumAddress).toLowerCase();
    const challenge = await prisma.ethereumAuthChallenge.findUnique({ where: { id: challengeId } });
    if (
      !challenge ||
      challenge.usedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.address !== normalizedAddress ||
      challenge.message !== message
    ) {
      res.status(401).json({ error: 'Authentication challenge is invalid, expired, or already used' });
      return;
    }

    // Verify the Ethereum signature
    if (!await verifyEthereumSignature(normalizedAddress, message, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const consumed = await prisma.ethereumAuthChallenge.updateMany({
      where: { id: challengeId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });
    if (consumed.count !== 1) {
      res.status(401).json({ error: 'Authentication challenge has already been used' });
      return;
    }

    // Get current user ID from token if present
    const currentUserId = await getCurrentUserFromToken(req);

    const user = await findOrCreateUser({
      ethereumAddress: normalizedAddress,
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
    if (error instanceof IdentityConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to authenticate with Ethereum' });
  }
});

// Provider handles are not credentials. Social authentication must use the OAuth flow below.
for (const provider of ['orcid', 'github', 'bitbucket', 'gitlab']) {
  router.post(`/login/${provider}`, (_req, res): void => {
    res.status(410).json({ error: `Use the verified ${provider} OAuth flow` });
  });
}

// Email registration endpoint
router.post('/register/email', emailRateLimit, async (req, res): Promise<void> => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email || '');
    const { name } = req.body;

    if (!normalizedEmail || normalizedEmail.length > 320) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length > 200)) {
      res.status(400).json({ error: 'Name must be a string of at most 200 characters' });
      return;
    }

    // Validate email format
    // In development mode, allow @localhost emails for testing
    const isDevelopment = process.env.NODE_ENV === 'development';
    const emailRegex = isDevelopment
      ? /^[^\s@]+@(localhost|127\.0\.0\.1|[\w.-]+\.[\w.-]+)$/
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // Get current user ID from token if present (for connecting additional accounts)
    const currentUserId = await getCurrentUserFromToken(req);

    // Check if email is already taken by another user (only if verified)
    const existingUserEmail = await prisma.userEmail.findUnique({
      where: { email: normalizedEmail },
      include: { user: true }
    });

    if (existingUserEmail && existingUserEmail.verified && (!currentUserId || existingUserEmail.userId !== currentUserId)) {
      res.status(400).json({ error: 'Email is already registered and verified' });
      return;
    }

    if (existingUserEmail && currentUserId && existingUserEmail.userId !== currentUserId) {
      res.status(400).json({ error: 'Email is already attached to another account' });
      return;
    }

    let user;
    let requiresVerification = true;

    if (currentUserId) {
      user = await prisma.$transaction(async (tx) => {
        const existingForCurrentUser = await tx.userEmail.findUnique({
          where: { email: normalizedEmail }
        });

        if (existingForCurrentUser?.verified) {
          requiresVerification = false;
        } else if (!existingForCurrentUser) {
          await tx.userEmail.create({
            data: {
              userId: currentUserId,
              email: normalizedEmail
            }
          });
        }

        await tx.user.update({
          where: { id: currentUserId },
          data: { name: name || undefined }
        });

        return syncPrimaryEmail(tx, currentUserId);
      });
    } else {
      if (existingUserEmail) {
        user = await syncPrimaryEmail(prisma, existingUserEmail.userId);
      } else {
        user = await prisma.$transaction(async (tx) => {
          const createdUser = await tx.user.create({
            data: {
              name: name || null,
              email: normalizedEmail,
              emailVerified: false
            }
          });

          await tx.userEmail.create({
            data: {
              userId: createdUser.id,
              email: normalizedEmail
            }
          });

          return syncPrimaryEmail(tx, createdUser.id);
        });
      }
    }

    if (requiresVerification) {
      const verificationToken = EmailService.generateVerificationToken();
      console.log('Sending verification email for user:', user.id);
      const emailSent = await EmailService.sendVerificationEmail(normalizedEmail, verificationToken, user.id);

      if (!emailSent) {
        res.status(500).json({ error: 'Failed to send verification email' });
        return;
      }
    }

    if (currentUserId) {
      const responseMessage = requiresVerification
        ? 'Verification email sent successfully'
        : 'Email is already verified';

      res.json({
        message: responseMessage,
        user,
        requiresVerification
      });
      return;
    }

    const responseMessage = 'Registration successful. Please check your email to verify your account.';

    res.json({
      message: responseMessage,
      user,
      requiresVerification
    });
  } catch (error: any) {
    console.error('Email registration error:', error);
    res.status(500).json({ error: 'Failed to register with email' });
  }
});

// Email verification endpoint
router.post('/verify/email', emailRateLimit, async (req, res): Promise<void> => {
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

    // Possession of the one-time email link is the authentication proof. Do not
    // create an authenticated session during registration, before that proof.
    const user = await getUserWithEmails(result.userId!);
    if (!user || user.isDeleted) {
      res.status(400).json({ error: 'User account is unavailable' });
      return;
    }
    const session = await createSession(user.id);

    res.json({
      message: 'Email verified successfully',
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error: any) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Resend verification email endpoint
router.post('/resend-verification', emailRateLimit, async (req, res): Promise<void> => {
  try {
    const requestedEmail = req.body?.email ? normalizeEmail(req.body.email) : null;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);

    // Find session and get user
    const session = await prisma.session.findUnique({
      where: { token: hashOpaqueToken(token) },
      include: {
        user: {
          include: userWithEmailsInclude
        }
      }
    });

    if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = session.user;

    const pendingEmails = user.emails.filter(email => !email.verified);
    const emailToResend = requestedEmail
      ? pendingEmails.find(email => email.email === requestedEmail)
      : pendingEmails[0];

    if (!emailToResend) {
      res.status(400).json({ error: 'No email address associated with this account' });
      return;
    }

    // Generate new verification token and send email
    const verificationToken = EmailService.generateVerificationToken();
    const emailSent = await EmailService.sendVerificationEmail(emailToResend.email, verificationToken, user.id);

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
      where: { token: hashOpaqueToken(token) }
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
      where: { token: hashOpaqueToken(token) },
      include: {
        user: {
          include: userWithEmailsInclude
        }
      }
    });

    if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    if (session.user.isDeleted) {
      res.status(401).json({ error: 'User account has been deleted' });
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
      where: { token: hashOpaqueToken(token) },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
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
      personalNumber: user.personalNumber,
      residenceCountry: user.residenceCountry
    });
  } catch (error: any) {
    console.error('Get KYC status error:', error);
    res.status(500).json({ error: 'Failed to get KYC status' });
  }
});

const oauthProviders = new Set<OAuthProvider>(['github', 'orcid', 'bitbucket', 'gitlab']);
const oauthCookieName = 'meritocracy_oauth_nonce';

function getOAuthProvider(value: unknown): OAuthProvider | null {
  return typeof value === 'string' && oauthProviders.has(value as OAuthProvider) ? value as OAuthProvider : null;
}

function getOAuthStateSecret(): string | null {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET;
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

function getCookie(req: express.Request, name: string): string | null {
  const cookieHeader = req.header('cookie');
  if (!cookieHeader) return null;
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return null;
}

function oauthCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${oauthCookieName}=${value}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/api/auth${secure}`;
}

function getOAuthAuthorizationUrl(provider: OAuthProvider, state: string): string | null {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) return null;
  const redirectUri = `${apiUrl}/api/auth/${provider}/callback`;

  if (provider === 'github' && process.env.GITHUB_CLIENT_ID) {
    const params = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: redirectUri, state });
    return `https://github.com/login/oauth/authorize?${params}`;
  }
  if (provider === 'orcid' && process.env.ORCID_CLIENT_ID) {
    const orcidDomain = process.env.ORCID_DOMAIN === 'sandbox.orcid.org' ? 'sandbox.orcid.org' : 'orcid.org';
    const params = new URLSearchParams({ client_id: process.env.ORCID_CLIENT_ID, response_type: 'code', scope: '/authenticate', redirect_uri: redirectUri, state });
    return `https://${orcidDomain}/oauth/authorize?${params}`;
  }
  if (provider === 'bitbucket' && process.env.BITBUCKET_CLIENT_ID) {
    const params = new URLSearchParams({ client_id: process.env.BITBUCKET_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, state });
    return `https://bitbucket.org/site/oauth2/authorize?${params}`;
  }
  if (provider === 'gitlab' && process.env.GITLAB_CLIENT_ID) {
    const params = new URLSearchParams({ client_id: process.env.GITLAB_CLIENT_ID, response_type: 'code', scope: 'read_user openid', redirect_uri: redirectUri, state });
    return `https://gitlab.com/oauth/authorize?${params}`;
  }
  return null;
}

function sendOAuthPopupMessage(res: express.Response, payload: unknown, status = 200): void {
  const frontendOrigin = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').origin;
  const serializedPayload = JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  res.send(`<!doctype html><meta charset="utf-8"><title>OAuth result</title><script>if(window.opener){window.opener.postMessage(${serializedPayload},${JSON.stringify(frontendOrigin)});}window.close();</script>`);
}

router.post('/oauth/:provider/start', oauthRateLimit, async (req, res): Promise<void> => {
  const provider = getOAuthProvider(req.params.provider);
  const stateSecret = getOAuthStateSecret();
  if (!provider) {
    res.status(400).json({ error: 'Unsupported OAuth provider' });
    return;
  }
  if (!stateSecret) {
    res.status(503).json({ error: 'OAuth state protection is not configured' });
    return;
  }

  const nonce = createOpaqueToken(24);
  const state = signOAuthState({
    provider,
    nonce,
    userId: await getCurrentUserFromToken(req),
    expiresAt: Date.now() + 10 * 60 * 1000
  }, stateSecret);
  const authorizationUrl = getOAuthAuthorizationUrl(provider, state);
  if (!authorizationUrl) {
    res.status(503).json({ error: `${provider} OAuth is not configured` });
    return;
  }

  res.setHeader('Set-Cookie', oauthCookie(nonce, 10 * 60));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authorizationUrl });
});

// OAuth providers redirect here. The response sends credentials directly to the
// exact configured frontend origin; provider codes and bearer tokens never enter URLs.
router.get('/:provider/callback', async (req, res): Promise<void> => {
  const provider = getOAuthProvider(req.params.provider);
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const stateSecret = getOAuthStateSecret();
  res.setHeader('Set-Cookie', oauthCookie('', 0));

  try {
    if (!provider || !code || code.length > 4096 || !state || !stateSecret) {
      sendOAuthPopupMessage(res, { type: 'OAUTH_ERROR', provider: provider || req.params.provider, error: 'Invalid OAuth callback' }, 400);
      return;
    }

    const statePayload = verifyOAuthState(state, stateSecret);
    const stateCookie = getCookie(req, oauthCookieName);
    if (
      !statePayload ||
      statePayload.provider !== provider ||
      statePayload.expiresAt < Date.now() ||
      !timingSafeEqualString(statePayload.nonce, stateCookie)
    ) {
      sendOAuthPopupMessage(res, { type: 'OAUTH_ERROR', provider, error: 'OAuth state validation failed' }, 401);
      return;
    }

    let userData: UserData;
    switch (provider) {
      case 'github': userData = await handleGitHubOAuth(code); break;
      case 'orcid': userData = await handleORCIDOAuth(code); break;
      case 'bitbucket': userData = await handleBitBucketOAuth(code); break;
      case 'gitlab': userData = await handleGitLabOAuth(code); break;
    }

    let currentUserId = statePayload.userId;
    if (currentUserId !== null) {
      const currentUser = await prisma.user.findUnique({ where: { id: currentUserId }, select: { isDeleted: true } });
      if (!currentUser || currentUser.isDeleted) currentUserId = null;
    }

    const user = await findOrCreateUser(userData, currentUserId);
    const session = await createSession(user.id);
    sendOAuthPopupMessage(res, {
      type: 'OAUTH_SUCCESS',
      provider,
      authData: { user, session: { token: session.token, expiresAt: session.expiresAt } }
    });
  } catch (error) {
    console.error(`${provider || 'unknown'} OAuth callback failed:`, error instanceof Error ? error.message : error);
    const isConflict = error instanceof IdentityConflictError;
    sendOAuthPopupMessage(
      res,
      { type: 'OAUTH_ERROR', provider: provider || req.params.provider, error: isConflict ? error.message : 'OAuth authentication failed' },
      isConflict ? 409 : 502
    );
  }
});

// OAuth handler functions
async function handleGitHubOAuth(code: string): Promise<UserData> {
  const requestBody = {
    client_id: process.env.GITHUB_CLIENT_ID!,
    client_secret: process.env.GITHUB_CLIENT_SECRET!,
    code: code,
    redirect_uri: `${process.env.API_URL}/api/auth/github/callback`,
  };

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
  if (!tokenResponse.ok) {
    throw new Error(`GitHub token exchange failed with status ${tokenResponse.status}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error('GitHub returned an invalid token response');
  }

  if (tokenData.error) {
    throw new Error('GitHub rejected the OAuth code');
  }

  if (typeof tokenData.access_token !== 'string') {
    throw new Error('GitHub token response did not include an access token');
  }
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    throw new Error(`GitHub user lookup failed with status ${userResponse.status}`);
  }

  const userData: any = await userResponse.json();

  return {
    githubHandle: userData.login,
    // name: userData.name,
    // email: userData.email,
  };
}

async function handleORCIDOAuth(code: string): Promise<UserData> {
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
  if (!tokenResponse.ok) {
    throw new Error(`ORCID token exchange failed with status ${tokenResponse.status}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error('ORCID returned an invalid token response');
  }

  if (tokenData.error) {
    throw new Error('ORCID rejected the OAuth code');
  }

  if (typeof tokenData.orcid !== 'string') {
    throw new Error('ORCID token response did not include an ORCID identifier');
  }

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
      redirect_uri: `${process.env.API_URL}/api/auth/bitbucket/callback`,
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
    bitbucketHandle: userData.nickname || userData.username,
    // name: userData.display_name,
    // email: userData.email,
  };
}

async function handleGitLabOAuth(code: string): Promise<UserData> {
  const requestBody = {
    client_id: process.env.GITLAB_CLIENT_ID!,
    client_secret: process.env.GITLAB_CLIENT_SECRET!,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: `${process.env.API_URL}/api/auth/gitlab/callback`,
  };

  // Exchange code for access token
  const tokenResponse = await fetch('https://gitlab.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(requestBody),
  });

  const responseText = await tokenResponse.text();
  if (!tokenResponse.ok) {
    throw new Error(`GitLab token exchange failed with status ${tokenResponse.status}`);
  }

  let tokenData: any;
  try {
    tokenData = JSON.parse(responseText);
  } catch (parseError) {
    throw new Error('GitLab returned an invalid token response');
  }

  if (tokenData.error) {
    throw new Error('GitLab rejected the OAuth code');
  }

  if (typeof tokenData.access_token !== 'string') {
    throw new Error('GitLab token response did not include an access token');
  }
  const userResponse = await fetch('https://gitlab.com/api/v4/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    throw new Error(`GitLab user lookup failed with status ${userResponse.status}`);
  }

  const userData: any = await userResponse.json();
  return {
    gitlabHandle: userData.username,
    // name: userData.name,
    // email: userData.email,
  };
}

// Disconnect provider endpoint
router.post('/disconnect/:provider', async (req, res): Promise<void> => {
  try {
    const requestedEmail = req.body?.email ? normalizeEmail(req.body.email) : null;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const { provider } = req.params;

    // Find session and get user
    const session = await prisma.session.findUnique({
      where: { token: hashOpaqueToken(token) },
      include: {
        user: {
          include: userWithEmailsInclude
        }
      }
    });

    if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = session.user;

    const result = await prisma.$transaction(async (tx) => {
      // Handle KYC disconnection specially
      if (provider === 'kyc') {
        if (user.kycStatus !== 'APPROVED') {
          res.status(400).json({ error: 'KYC not verified' });
          return null;
        }

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            kycStatus: null,
            kycVerifiedAt: null,
            kycRejectedAt: null,
            kycRejectionReason: null,
            issuingState: null,
            personalNumber: null,
            residenceCountry: null
          }
        });

        if (await maybeSoftDeleteDisconnectedAccount(tx, user.id)) {
          return {
            deleted: true,
            message: 'KYC disconnected and account deleted successfully',
            user: null
          };
        }

        return {
          deleted: false,
          message: 'KYC disconnected successfully',
          user: updatedUser
        };
      }

      if (provider === 'votingKyc') {
        if (user.kycVotingStatus !== 'APPROVED') {
          res.status(400).json({ error: 'KYC Level 1 not verified' });
          return null;
        }

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            kycVotingStatus: null,
            kycVotingVerifiedAt: null,
            kycVotingRejectedAt: null,
            kycVotingRejectionReason: null,
            kycVotingData: null
          }
        });

        if (await maybeSoftDeleteDisconnectedAccount(tx, user.id)) {
          return {
            deleted: true,
            message: 'KYC Level 1 disconnected and account deleted successfully',
            user: null
          };
        }

        return {
          deleted: false,
          message: 'KYC Level 1 disconnected successfully',
          user: updatedUser
        };
      }

      if (provider === 'email') {
        if (user.emails.length === 0 && !user.email) {
          res.status(400).json({ error: 'Provider not connected' });
          return null;
        }

        const emailToRemove = requestedEmail || user.emails[0]?.email || user.email;
        if (!emailToRemove) {
          res.status(400).json({ error: 'Email is required' });
          return null;
        }

        await tx.emailVerificationToken.deleteMany({
          where: {
            userId: user.id,
            email: emailToRemove
          }
        });

        await tx.userEmail.deleteMany({
          where: {
            userId: user.id,
            email: emailToRemove
          }
        });

        const updatedUser = await syncPrimaryEmail(tx, user.id);

        if (await maybeSoftDeleteDisconnectedAccount(tx, user.id)) {
          return {
            deleted: true,
            message: 'email disconnected and account deleted successfully',
            user: null
          };
        }

        return {
          deleted: false,
          message: 'email disconnected successfully',
          user: updatedUser
        };
      }

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
        return null;
      }

      // Check if the provider is actually connected
      if (!(user as any)[fieldToClear]) {
        res.status(400).json({ error: 'Provider not connected' });
        return null;
      }

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          [fieldToClear]: null
        },
        include: userWithEmailsInclude
      });

      if (await maybeSoftDeleteDisconnectedAccount(tx, user.id)) {
        return {
          deleted: true,
          message: `${provider} disconnected and account deleted successfully`,
          user: null
        };
      }

      return {
        deleted: false,
        message: `${provider} disconnected successfully`,
        user: updatedUser
      };
    });

    if (!result) {
      return;
    }

    res.json(result);
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
    if (!signature || !timestamp || !webhookSecretKey || typeof rawBodyString !== 'string' || !rawBody || typeof rawBody !== 'object') {
      console.error('Missing required webhook verification data');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    // Validate the timestamp to ensure the request is fresh (within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const incomingTime = parseInt(timestamp, 10);
    if (!Number.isFinite(incomingTime) || Math.abs(currentTime - incomingTime) > 300) {
      console.error('Request timestamp is stale');
      res.status(401).json({ message: 'Request timestamp is stale.' });
      return;
    }

    // Generate an HMAC from the raw body using the shared secret
    const hmac = crypto.createHmac('sha256', webhookSecretKey);
    const expectedSignature = hmac.update(rawBodyString).digest('hex');

    // Compare using timingSafeEqual for security
    if (!timingSafeEqualString(expectedSignature, signature)) {
      console.error('Didit webhook signature verification failed');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { session_id, status, webhook_type, vendor_data, decision, aml_screenings: aml, workflow_id } = rawBody;

    if (!session_id) {
      console.error('No session_id in Didit callback');
      res.status(400).json({ error: 'session_id is required' });
      return;
    }

    if (!['Approved', 'Declined', 'In Review', 'Abandoned'].includes(status)) {
      res.status(400).json({ error: 'Unsupported KYC status' });
      return;
    }

    const metadata = rawBody.metadata;
    const sessionId = metadata?.session_id;
    if (!process.env.INSTALLATION_UID || vendor_data !== process.env.INSTALLATION_UID || typeof sessionId !== 'string') {
      res.status(401).json({ error: 'Webhook is not bound to this installation and session' });
      return;
    }

    const isVotingFlow = workflow_id === process.env.DIDIT_WORKFLOW_VOTING_ID;
    const isLivelinessFlow = !!process.env.DIDIT_WORKFLOW_LIVELINESS_ID && workflow_id === process.env.DIDIT_WORKFLOW_LIVELINESS_ID;
    const isReceivingFlow = workflow_id === process.env.DIDIT_WORKFLOW_RECEIVING_ID;
    const expectedWorkflowType = isLivelinessFlow ? 'LIVELINESS' : isVotingFlow ? 'VOTING' : isReceivingFlow ? 'RECEIVING' : null;
    if (!expectedWorkflowType || metadata?.workflow_type !== expectedWorkflowType) {
      res.status(400).json({ error: 'Unexpected KYC workflow' });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true }
    });
    if (!session || session.user.isDeleted) {
      res.status(404).json({ error: 'KYC session binding not found' });
      return;
    }
    const user = session.user;

    // Update user KYC status based on Didit response
    const updateData: any = {};

    // Handle different statuses according to Didit webhook format
    // Trust the main status 'Approved' as authoritative for the session
    if (status === 'Approved') {
      if (isLivelinessFlow) {
        const verifiedAt = new Date();
        updateData.livelinessStatus = 'APPROVED';
        updateData.livelinessVerifiedAt = verifiedAt;
        updateData.livelinessDueAt = getLivelinessDueAt(verifiedAt);
        updateData.livelinessRequestedAt = null;
      } else if (isVotingFlow) {
        // Voting KYC Flow: Sets ONLY Voting Status
        updateData.kycVotingStatus = 'APPROVED';
        updateData.kycVotingVerifiedAt = new Date();
        updateData.kycVotingRejectedAt = null;
        updateData.kycVotingRejectionReason = null;
      } else {
        // Receiver KYC Flow: Sets BOTH Receiver Status AND Voting Status
        // Primary: Receiver Status
        updateData.kycStatus = 'APPROVED';
        updateData.kycVerifiedAt = new Date();
        updateData.kycRejectedAt = null;
        updateData.kycRejectionReason = null;

        // Secondary: Voting Status (passing Level 2 implies passing Level 1)
        updateData.kycVotingStatus = 'APPROVED';
        updateData.kycVotingVerifiedAt = new Date();
        updateData.kycVotingRejectedAt = null;
        updateData.kycVotingRejectionReason = null;
      }

      // Mark any unused KYC tokens for this user as used (Only for Receiver flow usually, but safe to do check)
      if (!isVotingFlow) {
        try {
          await (prisma as any).kycToken.updateMany({
            where: {
              userId: user.id,
              used: false
            },
            data: { used: true }
          });
        } catch (tokenError) {
          console.error('Failed to mark KYC tokens as used for user:', user.id, tokenError);
        }
      }

      // Store additional verification data if available
      if (!isLivelinessFlow && decision && decision.id_verification) {
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

        if (idData.residence) {
          updateData.residenceCountry = idData.residence;
        }

        const kycDataStr = JSON.stringify({
          documentType: idData.document_type,
          documentNumber: idData.document_number,
          firstName: idData.first_name,
          lastName: idData.last_name,
          dateOfBirth: idData.date_of_birth,
          nationality: idData.nationality,
          issuingState: idData.issuing_state,
          residence: idData.residence,
          expirationDate: idData.expiration_date
        });

        if (isLivelinessFlow) {
          // Liveliness does not store KYC rejection details.
        } else if (isVotingFlow) {
          updateData.kycVotingData = kycDataStr;
        } else {
          updateData.kycData = kycDataStr;
        }
      }
    } else if (status === 'Declined' || aml?.status === 'Rejected') {
      const reason = 'Verification declined by Didit';
      if (isLivelinessFlow) {
        updateData.livelinessStatus = 'REJECTED';
      } else if (isVotingFlow) {
        updateData.kycVotingStatus = 'REJECTED';
        updateData.kycVotingRejectedAt = new Date();
        updateData.kycVotingRejectionReason = reason;
        updateData.kycVotingVerifiedAt = null;
      } else {
        updateData.kycStatus = 'REJECTED';
        updateData.kycRejectedAt = new Date();
        updateData.kycRejectionReason = reason;
        updateData.kycVerifiedAt = null;
      }

      // Store rejection details if available
      let rejectionReason = reason;
      if (decision && decision.reviews && String(decision.reviews).length > 0) {
        const review = decision.reviews[0];
        rejectionReason = review.comment || reason;
        if (isVotingFlow) {
          updateData.kycVotingRejectionReason = rejectionReason;
        } else {
          updateData.kycRejectionReason = rejectionReason;
        }
      }

      // Send OFAC report only for AML rejections (sanctions screening)
      if (!isLivelinessFlow && aml?.status === 'Rejected') {
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
            console.log('OFAC report sent successfully for AML rejection - user:', user.id);
          } else {
            console.error('Failed to send OFAC report for AML rejection - user:', user.id);
          }
        } catch (emailError) {
          console.error('Error sending OFAC report for AML rejection:', emailError);
          // Don't fail the entire KYC callback if email fails
        }
      }
    } else if (status === 'In Review') {
      if (isLivelinessFlow) updateData.livelinessStatus = 'PENDING';
      else if (isVotingFlow) updateData.kycVotingStatus = 'PENDING';
      else updateData.kycStatus = 'PENDING';
    } else if (status === 'Abandoned') {
      if (isLivelinessFlow) updateData.livelinessStatus = 'ABANDONED';
      else if (isVotingFlow) updateData.kycVotingStatus = 'ABANDONED';
      else updateData.kycStatus = 'ABANDONED';
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
      incomingStatus: status, // DEBUG: Received status
      incomingAmlStatus: aml?.status, // DEBUG: Received AML status
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
router.post('/kyc/initiate', kycRateLimit, async (req, res): Promise<void> => {
  try {
    const { kycToken } = req.body;

    let session;
    let user;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // User is authenticated, use existing session
      const token = authHeader.substring(7);

      session = await prisma.session.findUnique({
        where: { token: hashOpaqueToken(token) },
        include: { user: true }
      });

      if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      user = session.user;

      // Validate the KYC token if provided (Level 2)
      if (kycToken) {
        const verificationResult = await EmailService.consumeKycToken(kycToken, user.id);
        if (!verificationResult.success) {
          res.status(403).json({ error: verificationResult.error });
          return;
        }
      }
    } else {
      // Unauthenticated KYC initiation requires a token (Level 2 link)
      if (!kycToken) {
        res.status(401).json({ error: 'Please log in to initiate KYC' });
        return;
      }

      const tokenResult = await EmailService.consumeKycToken(kycToken);
      if (!tokenResult.success || !tokenResult.userId) {
        res.status(403).json({ error: tokenResult.error || 'Invalid KYC token' });
        return;
      }
      user = await prisma.user.findUnique({ where: { id: tokenResult.userId } });
      if (!user || user.isDeleted) {
        res.status(403).json({ error: 'KYC account is unavailable' });
        return;
      }

      // Create a session for this user so they are authenticated
      session = await createSession(user.id);

      console.log('User authenticated via KYC token:', user.id);
    }

    // Determine workflow ID
    let workflowId = process.env.DIDIT_WORKFLOW_VOTING_ID;
    let isReceiverFlow = false;

    if (kycToken) {
      workflowId = process.env.DIDIT_WORKFLOW_RECEIVING_ID;
      isReceiverFlow = true;
    }

    if (!workflowId) {
      res.status(500).json({ error: 'KYC workflow configuration missing' });
      return;
    }

    // Check environment variables
    if (!process.env.INSTALLATION_UID || !process.env.DIDIT_API_KEY) {
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
        workflow_id: workflowId,
        vendor_data: process.env.INSTALLATION_UID,
        metadata: {
          session_id: session.id,
          workflow_type: isReceiverFlow ? 'RECEIVING' : 'VOTING'
        },
      })
    });

    if (!diditResponse.ok) {
      console.error('Didit API error:', {
        status: diditResponse.status,
        statusText: diditResponse.statusText
      });
      res.status(500).json({ error: 'Failed to initiate KYC session' });
      return;
    }

    const diditData: any = await diditResponse.json();

    if (!diditData.url) {
      console.error('Didit API response did not include a verification URL');
      res.status(500).json({ error: 'Invalid response from KYC service' });
      return;
    }

    // Store KYC session info - Update correct status field
    const updateStatusData: any = {};
    if (isReceiverFlow) {
      updateStatusData.kycStatus = 'PENDING';
    } else {
      updateStatusData.kycVotingStatus = 'PENDING';
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateStatusData
    });

    const response: any = {
      url: diditData.url,
      sessionId: diditData.session_id || null
    };

    // If we established a new session (was unauthenticated), return it
    if ((!authHeader || !authHeader.startsWith('Bearer ')) && session) {
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

// Didit Liveliness initiation. An email link may authenticate the user with a
// one-time token; an already signed-in user may also restart an overdue check.
router.post('/liveliness/initiate', kycRateLimit, async (req, res): Promise<void> => {
  try {
    const { livelinessToken } = req.body as { livelinessToken?: string };
    const authHeader = req.headers.authorization;
    let session: any = null;
    let user: any = null;
    let tokenAuthenticated = false;

    if (authHeader?.startsWith('Bearer ')) {
      session = await prisma.session.findUnique({
        where: { token: hashOpaqueToken(authHeader.substring(7)) },
        include: { user: true }
      });
      if (!session || session.expiresAt < new Date() || session.user.isDeleted) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      user = session.user;
      if (livelinessToken) {
        const verification = await EmailService.consumeKycToken(livelinessToken, user.id);
        if (!verification.success) {
          res.status(403).json({ error: verification.error });
          return;
        }
      }
    } else {
      if (!livelinessToken) {
        res.status(401).json({ error: 'Please log in or use the link from the Liveliness email' });
        return;
      }
      const tokenResult = await EmailService.consumeKycToken(livelinessToken);
      if (!tokenResult.success || !tokenResult.userId) {
        res.status(403).json({ error: tokenResult.error || 'Invalid or expired Liveliness token' });
        return;
      }
      user = await prisma.user.findUnique({ where: { id: tokenResult.userId } });
      if (!user || user.isDeleted) {
        res.status(403).json({ error: 'Liveliness account is unavailable' });
        return;
      }
      session = await createSession(user.id);
      tokenAuthenticated = true;
    }

    const workflowId = process.env.DIDIT_WORKFLOW_LIVELINESS_ID;
    if (!workflowId || !process.env.INSTALLATION_UID || !process.env.DIDIT_API_KEY) {
      res.status(500).json({ error: 'Liveliness service configuration missing' });
      return;
    }

    const diditResponse = await fetch('https://verification.didit.me/v2/session/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.DIDIT_API_KEY },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: process.env.INSTALLATION_UID,
        metadata: { session_id: session!.id, workflow_type: 'LIVELINESS' }
      })
    });
    if (!diditResponse.ok) {
      console.error('Didit Liveliness API error:', diditResponse.status);
      res.status(500).json({ error: 'Failed to initiate Didit Liveliness check' });
      return;
    }
    const diditData: any = await diditResponse.json();
    if (!diditData.url) {
      res.status(500).json({ error: 'Invalid response from Liveliness service' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { livelinessStatus: 'PENDING', livelinessRequestedAt: new Date() }
    });

    const response: any = { url: diditData.url, sessionId: diditData.session_id || null };
    if (tokenAuthenticated) {
      response.session = { token: session!.token, expiresAt: session!.expiresAt };
      response.user = user;
    }
    res.json(response);
  } catch (error) {
    console.error('Liveliness initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate Didit Liveliness check' });
  }
});

// Cleanup expired sessions (should be called periodically)
router.delete('/sessions/cleanup', requireAdmin, async (req, res) => {
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
