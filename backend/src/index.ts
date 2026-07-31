// Polyfill fetch for Node.js - must be first
import fetch from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './db-secrets.js';

import userRoutes from './routes/users.js';
import authRoutes from './routes/auth.js';
import evaluationRoutes from './routes/evaluation.js';
import globalRoutes from './routes/global.js';
import logsRoutes from './routes/logs.js';
import cronRoutes from './routes/cron.js';
import multiNetworkGasRoutes from './routes/multi-network-gas.js';
import cleanupRoutes from './routes/cleanup.js';
import adminRoutes from './routes/admin.js';
import banVotingRoutes from './routes/banVoting.js';

// Register TaskRunners
import { registerAllRunners } from './runners/OpenAIRunners.js';
import { GlobalDataService } from './services/GlobalDataService.js';
import { multiNetworkGasTokenDistributionService } from './services/MultiNetworkGasTokenDistributionService.js';
import { prisma } from './lib/prisma.js';

// Register all TaskRunners on startup
registerAllRunners();

const app = express();
const PORT = process.env.PORT || 3001;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const apiUrl = process.env.API_URL || `http://localhost:${PORT}`;
const frontendHost = new URL(frontendUrl).hostname;
const frontendOrigin = new URL(frontendUrl).origin;
const backendDirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(backendDirname, '../../frontend/dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');
const frontendAssetsAvailable = fs.existsSync(frontendIndexPath);
const frontendStatic = frontendAssetsAvailable ? express.static(frontendDistPath, { index: false }) : null;
const reownConnectSrc = [
  'https://rpc.walletconnect.com',
  'https://rpc.walletconnect.org',
  'https://relay.walletconnect.com',
  'https://relay.walletconnect.org',
  'wss://relay.walletconnect.com',
  'wss://relay.walletconnect.org',
  'https://pulse.walletconnect.com',
  'https://pulse.walletconnect.org',
  'https://api.web3modal.com',
  'https://api.web3modal.org',
  'https://keys.walletconnect.com',
  'https://keys.walletconnect.org',
  'https://notify.walletconnect.com',
  'https://notify.walletconnect.org',
  'https://echo.walletconnect.com',
  'https://echo.walletconnect.org',
  'https://push.walletconnect.com',
  'https://push.walletconnect.org',
  'wss://www.walletlink.org',
  'https://cca-lite.coinbase.com',
] as const;
const evmRpcConnectSrc = [
  'https://eth.merkle.io',
  'https://11155111.rpc.thirdweb.com',
  'https://polygon-rpc.com',
  'https://arb1.arbitrum.io/rpc',
  'https://mainnet.optimism.io',
  'https://mainnet.base.org',
  'https://forno.celo.org',
] as const;

const isFrontendHost = (host?: string) => Boolean(host && host === frontendHost);
const isLocalhostOrigin = (origin?: string) => {
  if (!origin) {
    return false;
  }

  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
  } catch {
    return false;
  }
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://fonts.reown.com'],
      connectSrc: ["'self'", process.env.API_URL!, ...reownConnectSrc, ...evmRpcConnectSrc],
      frameSrc: ["'self'", 'https://verify.walletconnect.com', 'https://verify.walletconnect.org', 'https://secure.walletconnect.com', 'https://secure.walletconnect.org'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (origin === frontendOrigin || (process.env.NODE_ENV !== 'production' && isLocalhostOrigin(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true,
}));
app.use(morgan('combined'));
// Configure body parsing with raw body capture for webhook signature verification
app.use(express.json({
  limit: '256kb',
  verify: (req, res, buf, encoding) => {
    if (buf && buf.length) {
      // Store the raw body in the request object for webhook signature verification
      (req as any).rawBody = buf.toString(encoding as BufferEncoding || 'utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Routes
app.get('/', (req, res) => {
  if (isFrontendHost(req.hostname) && frontendAssetsAvailable) {
    res.sendFile(frontendIndexPath);
    return;
  }

  res.json({
    message: 'Meritocracy API Server',
    version: '0.0.1',
    status: 'running',
  });
});

app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/global', globalRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/multi-network-gas', multiNetworkGasRoutes);
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ban-voting', banVotingRoutes);

if (frontendStatic) {
  app.use((req, res, next) => {
    if (!isFrontendHost(req.hostname) || req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }

    frontendStatic(req, res, (err) => {
      if (err) {
        next(err);
        return;
      }

      if (!res.headersSent) {
        res.sendFile(frontendIndexPath);
      }
    });
  });
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  if (isFrontendHost(req.hostname) && req.method === 'GET') {
    res.sendFile(frontendIndexPath, (error) => {
      if (error) {
        res.status(404).json({
          error: 'Route not found',
          message: `Cannot ${req.method} ${req.originalUrl}`,
        });
      }
    });
    return;
  }

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

    // Resume any distributions that were left pending when the process was interrupted.
    void multiNetworkGasTokenDistributionService.executePendingTransactions(undefined, 5000).catch(error => {
      console.error('❌ Failed to recover pending gas token transactions on startup:', error);
    });

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

    // Graceful shutdown handling
    process.on('SIGINT', () => {
      console.log('🛑 Shutting down gracefully...');
      prisma.$disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Shutting down gracefully...');
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

const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Error: Port ${PORT} is already in use. Please kill the process using it and try again.`);
  } else {
    console.error('❌ Error starting server:', error);
  }
  process.exit(1);
});
