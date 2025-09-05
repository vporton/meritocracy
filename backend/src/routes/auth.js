const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const router = express.Router();
const prisma = new PrismaClient();

// Helper function to find or create user based on provided data
async function findOrCreateUser(userData) {
  const { email, name, ethereumAddress, orcidId, githubHandle, bitbucketHandle, gitlabHandle } = userData;
  
  // First, check for exact matches using unique fields
  const searchConditions = [];
  if (email) searchConditions.push({ email });
  if (ethereumAddress) searchConditions.push({ ethereumAddress });
  if (orcidId) searchConditions.push({ orcidId });
  if (githubHandle) searchConditions.push({ githubHandle });
  if (bitbucketHandle) searchConditions.push({ bitbucketHandle });
  if (gitlabHandle) searchConditions.push({ gitlabHandle });

  if (searchConditions.length === 0) {
    throw new Error('No identifying information provided');
  }

  // Find existing users that match any of the unique fields
  const existingUsers = await prisma.user.findMany({
    where: {
      OR: searchConditions
    }
  });

  if (existingUsers.length === 0) {
    // No existing user found, create new one
    return await prisma.user.create({
      data: {
        email: email || `temp_${uuidv4()}@example.com`, // Fallback email if not provided
        name,
        ethereumAddress,
        orcidId,
        githubHandle,
        bitbucketHandle,
        gitlabHandle
      }
    });
  } else if (existingUsers.length === 1) {
    // One user found, update with new information
    const existingUser = existingUsers[0];
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
  } else {
    // Multiple users found - they represent the same person across different platforms
    // Delete all existing users and create a new merged one
    const userIds = existingUsers.map(user => user.id);
    
    // Get all data from existing users to merge
    const mergedData = {
      email: email || existingUsers.find(u => u.email)?.email || `merged_${uuidv4()}@example.com`,
      name: name || existingUsers.find(u => u.name)?.name,
      ethereumAddress: ethereumAddress || existingUsers.find(u => u.ethereumAddress)?.ethereumAddress,
      orcidId: orcidId || existingUsers.find(u => u.orcidId)?.orcidId,
      githubHandle: githubHandle || existingUsers.find(u => u.githubHandle)?.githubHandle,
      bitbucketHandle: bitbucketHandle || existingUsers.find(u => u.bitbucketHandle)?.bitbucketHandle,
      gitlabHandle: gitlabHandle || existingUsers.find(u => u.gitlabHandle)?.gitlabHandle
    };

    // Delete existing users
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds
        }
      }
    });

    // Create new merged user
    return await prisma.user.create({
      data: mergedData
    });
  }
}

// Helper function to create session
async function createSession(userId) {
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
router.post('/login/ethereum', async (req, res) => {
  try {
    const { ethereumAddress, signature, message, name } = req.body;
    
    if (!ethereumAddress) {
      return res.status(400).json({ error: 'Ethereum address is required' });
    }

    // In a real implementation, you would verify the signature here
    // For now, we'll just trust the provided address
    
    const user = await findOrCreateUser({
      ethereumAddress,
      name
    });
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    console.error('Ethereum login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Ethereum' });
  }
});

// ORCID OAuth callback endpoint
router.post('/login/orcid', async (req, res) => {
  try {
    const { orcidId, accessToken, name, email } = req.body;
    
    if (!orcidId) {
      return res.status(400).json({ error: 'ORCID ID is required' });
    }

    const user = await findOrCreateUser({
      orcidId,
      email,
      name
    });
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    console.error('ORCID login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with ORCID' });
  }
});

// GitHub OAuth callback endpoint
router.post('/login/github', async (req, res) => {
  try {
    const { githubHandle, accessToken, name, email } = req.body;
    
    if (!githubHandle) {
      return res.status(400).json({ error: 'GitHub handle is required' });
    }

    const user = await findOrCreateUser({
      githubHandle,
      email,
      name
    });
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    console.error('GitHub login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with GitHub' });
  }
});

// BitBucket OAuth callback endpoint
router.post('/login/bitbucket', async (req, res) => {
  try {
    const { bitbucketHandle, accessToken, name, email } = req.body;
    
    if (!bitbucketHandle) {
      return res.status(400).json({ error: 'BitBucket handle is required' });
    }

    const user = await findOrCreateUser({
      bitbucketHandle,
      email,
      name
    });
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    console.error('BitBucket login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with BitBucket' });
  }
});

// GitLab OAuth callback endpoint
router.post('/login/gitlab', async (req, res) => {
  try {
    const { gitlabHandle, accessToken, name, email } = req.body;
    
    if (!gitlabHandle) {
      return res.status(400).json({ error: 'GitLab handle is required' });
    }

    const user = await findOrCreateUser({
      gitlabHandle,
      email,
      name
    });
    
    const session = await createSession(user.id);
    
    res.json({
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    console.error('GitLab login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with GitLab' });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Delete the session
    await prisma.session.deleteMany({
      where: { token }
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user endpoint
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Find session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });
    
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    res.json({ user: session.user });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to get current user' });
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
  } catch (error) {
    console.error('Session cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup sessions' });
  }
});

module.exports = router;
