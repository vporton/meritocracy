import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// import environment from 'vite-plugin-environment';
import dotenv from 'dotenv';

dotenv.config();

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    // environment("all", { prefix: "VITE_" }),
  ],
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'crypto-browserify', 'stream-browserify'],
  },
  preview: {
    allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', 'socialism.fly.dev'],
  },
})
