import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required to initialize Prisma');
}

function createAdapter(): PrismaPg {
  return new PrismaPg({
    connectionString: databaseUrl
  });
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: createAdapter()
  });
}

export const prisma = createPrismaClient();
