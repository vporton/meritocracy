import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Polyfill fetch for Node.js
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
}

dotenv.config();

import userRoutes from './routes/users';
import authRoutes from './routes/auth';
import ethereumRoutes from './routes/ethereum';
import evaluationRoutes from './routes/evaluation';
import globalRoutes from './routes/global';

// Register TaskRunners
import { registerAllRunners } from './runners/OpenAIRunners';
import { GlobalDataService } from './services/GlobalDataService';

// Register all TaskRunners on startup
registerAllRunners();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());
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

// Initialize global data on startup
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
  } catch (error) {
    console.error('❌ Error initializing global data:', error);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  
  // Initialize global data
  await initializeApp();
});
