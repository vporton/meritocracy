import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// import environment from 'vite-plugin-environment';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    // nodePolyfills(),
    // environment("all", { prefix: "VITE_" }),
  ],
})
