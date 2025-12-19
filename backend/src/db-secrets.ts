import { systemSecretService } from './services/SystemSecretService.js';
import dotenv from 'dotenv';

// Load .env first
dotenv.config();

// Initialize secrets from DB and .secret files (for migration)
// This top-level await will block any importing module until initialization is complete.
await systemSecretService.initialize();
