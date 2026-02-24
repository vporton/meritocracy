import { prisma } from '../lib/prisma.js';
import { CronService } from './CronService.js';

export const cronService = new CronService(prisma);
