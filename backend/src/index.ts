// Polyfill fetch for Node.js - must be first
import fetch from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// TODO@P3: duplicate code
dotenv.config();
dotenv.config({ path: 'ethereum-keys.secret' });

import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import ethereumRoutes from './routes/ethereum.js';
import evaluationRoutes from './routes/evaluation.js';
import globalRoutes from './routes/global.js';
import logsRoutes from './routes/logs.js';
import cronRoutes from './routes/cron.js';
import multiNetworkGasRoutes from './routes/multi-network-gas.js';
import cleanupRoutes from './routes/cleanup.js';

// Register TaskRunners
import { registerAllRunners } from './runners/OpenAIRunners.js';
import { GlobalDataService } from './services/GlobalDataService.js';
import { CronService } from './services/CronService.js';
import { PrismaClient } from '@prisma/client';

// Register all TaskRunners on startup
registerAllRunners();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // TODO@P3
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.API_URL!],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginOpenerPolicy: {policy: "unsafe-none"},
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('combined'));
// Configure body parsing with raw body capture for webhook signature verification
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    if (buf && buf.length) {
      // Store the raw body in the request object for webhook signature verification
      (req as any).rawBody = buf.toString(encoding as BufferEncoding || 'utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Socialism API Server',
    version: '0.0.1',
    status: 'running',
  });
});

app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ethereum', ethereumRoutes);
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/global', globalRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/multi-network-gas', multiNetworkGasRoutes);
app.use('/api/cleanup', cleanupRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Initialize global data and cron services on startup
async function initializeApp() {
  try {
    console.log('🔄 Initializing global data...');
    await GlobalDataService.initializeGlobalData();
    
    // Set up monthly GDP update check
    setInterval(async () => {
      try {
        const shouldUpdate = await GlobalDataService.shouldUpdateGdp();
        if (shouldUpdate) {
          console.log('📈 Updating world GDP data...');
          await GlobalDataService.fetchAndUpdateWorldGdp();
        }
      } catch (error) {
        console.error('Error in scheduled GDP update:', error);
      }
    }, 24 * 60 * 60 * 1000); // Check daily (24 hours)
    
    console.log('✅ Global data initialization complete');
    
    // Initialize cron service
    console.log('🔄 Initializing cron service...');
    const prisma = new PrismaClient();
    const cronService = new CronService(prisma);
    
    // Start the bi-monthly evaluation cron job
    cronService.startBiMonthlyEvaluationCron();
    
    // Start the weekly gas token distribution cron job
    cronService.startWeeklyGasDistributionCron();
    
    // Start the monthly disconnected account cleanup cron job
    cronService.startMonthlyCleanupCron();
    
    console.log('✅ Cron service initialization complete');
    
    // Graceful shutdown handling
    process.on('SIGINT', () => {
      console.log('🛑 Shutting down gracefully...');
      cronService.destroy();
      prisma.$disconnect();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('🛑 Shutting down gracefully...');
      cronService.destroy();
      prisma.$disconnect();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Error initializing app:', error);
  }
}

// Initialize global data
await initializeApp();
console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
