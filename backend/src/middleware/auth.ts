import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Middleware to extract user ID from authorization token
export async function getCurrentUserFromToken(req: express.Request): Promise<number | null> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    
    // Find session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });
    
    if (!session || session.expiresAt < new Date()) {
      return null;
    }
    
    return session.user.id;
  } catch (error) {
    console.error('Error extracting user from token:', error);
    return null;
  }
}

// Middleware to require authentication
export async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  const userId = await getCurrentUserFromToken(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  (req as any).userId = userId;
  next();
}

// Middleware to optionally authenticate (doesn't fail if no token)
export async function optionalAuth(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  const userId = await getCurrentUserFromToken(req);
  (req as any).userId = userId;
  next();
}

// Middleware to require KYC verification
export async function requireKYC(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        kycStatus: true, 
        kycVerifiedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Require KYC verification
    if (user.kycStatus !== 'APPROVED' || !user.kycVerifiedAt) {
      res.status(403).json({
        error: 'KYC verification is required',
        kycStatus: user.kycStatus,
        kycVerifiedAt: user.kycVerifiedAt,
        kycRejectedAt: user.kycRejectedAt,
        kycRejectionReason: user.kycRejectionReason
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Error checking KYC status:', error);
    res.status(500).json({ error: 'Failed to verify KYC status' });
  }
}

// Middleware to require additional connections beyond KYC and Ethereum
export async function requireAdditionalConnections(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        orcidId: true,
        githubHandle: true,
        bitbucketHandle: true,
        gitlabHandle: true
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check if user has at least one additional connection beyond KYC and Ethereum
    const hasAdditionalConnection = !!(
      user.orcidId || 
      user.githubHandle || 
      user.bitbucketHandle || 
      user.gitlabHandle
    );

    if (!hasAdditionalConnection) {
      res.status(403).json({
        error: 'Additional connections are required for worth assessment',
        message: 'You must connect at least one of the following: ORCID, GitHub, Bitbucket, or GitLab',
        requiredConnections: ['ORCID', 'GitHub', 'Bitbucket', 'GitLab'],
        currentConnections: {
          orcidId: user.orcidId,
          githubHandle: user.githubHandle,
          bitbucketHandle: user.bitbucketHandle,
          gitlabHandle: user.gitlabHandle
        }
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Error checking additional connections:', error);
    res.status(500).json({ error: 'Failed to verify additional connections' });
  }
}
