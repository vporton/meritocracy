import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// import environment from 'vite-plugin-environment';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

dotenv.config();

const polyfillsPath = fileURLToPath(new URL('./src/polyfills.ts', import.meta.url));
const indexPath = fileURLToPath(new URL('./index.html', import.meta.url));

const staticRoutes = new Set([
  '/',
  '/treasury',
  '/ban-voting',
  '/logs',
  '/audit-log',
  '/ban-voting/timing-plan',
  '/timing-plan',
  '/defense-panel',
  '/connect',
  '/verify-email',
  '/admin',
]);

const isPrerenderedRoute = (pathname: string) =>
  staticRoutes.has(pathname) || /^\/logs\/[^/]+\/?$/.test(pathname);

const serializePageData = (data: unknown) => JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const injectPrerenderedPage = (template: string, html: string, head: string, data: unknown) => template
  .replace('<div id="root"></div>', `<div id="root">${html}</div>`)
  .replace('    <title>SciWard App</title>\n', '')
  .replace(
    '</head>',
    `${head}\n<script id="__PRERENDER_DATA__" type="application/json">${serializePageData(data)}</script>\n  </head>`,
  );

const reactPrerenderDev = (): Plugin => ({
  name: 'react-prerender-dev',
  apply: 'serve' as const,
  configureServer(server) {
    // Handle documents before Vite's SPA fallback returns the empty template.
    server.middlewares.use(async (request, response, next) => {
      if (request.method !== 'GET' || !request.url) {
        next();
        return;
      }

      const url = new URL(request.url, 'http://localhost');
      if (!isPrerenderedRoute(url.pathname)) {
        next();
        return;
      }

      try {
        const source = await readFile(indexPath, 'utf8');
        const template = await server.transformIndexHtml(request.url, source);
        const renderer = await server.ssrLoadModule('/src/entry-server.tsx');
        const rendered = await renderer.render(request.url);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(injectPrerenderedPage(template, rendered.html, rendered.head, rendered.data));
      } catch (error) {
        server.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  },
});

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
    reactPrerenderDev(),
    // environment("all", { prefix: "VITE_" }),
  ],
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.browser': 'true',
    'process.version': JSON.stringify('v18.16.0'),
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
      randomfill: polyfillsPath,
    },
  },
  optimizeDeps: {
    include: ['buffer', 'crypto-browserify', 'stream-browserify', 'ethers', 'wagmi', 'axios'],
  },
  ssr: {
    // react-helmet-async publishes CommonJS server exports. Bundling it keeps
    // those exports interoperable in Vite's ESM prerender artifact.
    noExternal: ['react-helmet-async'],
  },
  preview: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      'merit.science-dao.org',
      'api.merit.science-dao.org',
      'merit-staging.science-dao.org',
      'api.merit-staging.science-dao.org',
    ],
  },
})
