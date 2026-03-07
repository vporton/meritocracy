import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function obfuscateEmail(email: string): string {
  const digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 12);
  return `[email:${digest}]`;
}

export function getSortedUserEmails<T extends { email: string; verified: boolean; createdAt: Date }>(emails: T[]): T[] {
  return [...emails].sort((a, b) => {
    if (a.verified !== b.verified) {
      return a.verified ? -1 : 1;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function extractVerifiedEmails(userData: {
  email?: string | null;
  emailVerified?: boolean | null;
  emails?: Array<{ email: string; verified: boolean }> | null;
}): string[] {
  const relationEmails = (userData.emails ?? [])
    .filter(email => email.verified)
    .map(email => normalizeEmail(email.email));

  if (relationEmails.length > 0) {
    return Array.from(new Set(relationEmails));
  }

  if (userData.email && userData.emailVerified) {
    return [normalizeEmail(userData.email)];
  }

  return [];
}

export function extractAllEmails(userData: {
  email?: string | null;
  emails?: Array<{ email: string }> | null;
}): string[] {
  const relationEmails = (userData.emails ?? []).map(email => normalizeEmail(email.email));
  if (relationEmails.length > 0) {
    return Array.from(new Set(relationEmails));
  }

  if (userData.email) {
    return [normalizeEmail(userData.email)];
  }

  return [];
}

export async function syncPrimaryEmail(prisma: PrismaLike, userId: number) {
  const emails = await prisma.userEmail.findMany({
    where: { userId },
    orderBy: [
      { verified: 'desc' },
      { createdAt: 'asc' }
    ]
  });

  const primary = emails[0];

  return prisma.user.update({
    where: { id: userId },
    data: {
      email: primary?.email ?? null,
      emailVerified: primary?.verified ?? false
    },
    include: {
      emails: {
        orderBy: [
          { verified: 'desc' },
          { createdAt: 'asc' }
        ]
      }
    }
  });
}

export async function removeAllUserEmails(prisma: PrismaLike, userId: number): Promise<void> {
  await prisma.userEmail.deleteMany({
    where: { userId }
  });
}

export async function getUserEmailAddresses(prisma: PrismaLike, userId: number): Promise<string[]> {
  const emails = await prisma.userEmail.findMany({
    where: { userId },
    select: { email: true }
  });

  if (emails.length > 0) {
    return emails.map(item => item.email);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });

  return user?.email ? [user.email] : [];
}

export async function getVerifiedEmailAddresses(prisma: PrismaLike, userId: number): Promise<string[]> {
  const emails = await prisma.userEmail.findMany({
    where: { userId, verified: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' }
  });

  if (emails.length > 0) {
    return emails.map(item => item.email);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true }
  });

  return user?.email && user.emailVerified ? [user.email] : [];
}

export function obfuscateEmailsInValue(value: unknown, emails: string[]): unknown {
  if (emails.length === 0) {
    return value;
  }

  if (typeof value === 'string') {
    let result = value;
    for (const email of emails) {
      const normalized = normalizeEmail(email);
      const pattern = new RegExp(escapeRegExp(normalized), 'gi');
      result = result.replace(pattern, obfuscateEmail(normalized));
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map(item => obfuscateEmailsInValue(item, emails));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      obfuscateEmailsInValue(item, emails)
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
