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
