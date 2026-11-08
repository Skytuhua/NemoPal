import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root, base: './', plugins: [react(), tailwindcss(), {
    name: 'development-csp', apply: 'serve',
    // Vite injects development-only refresh/style tags. Packaged HTML stays strict.
    transformIndexHtml: html => html.replace("script-src 'self'; style-src 'self';", "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';").replace("connect-src 'none';", "connect-src 'self' ws://127.0.0.1:*;"),
  }],
  resolve: { alias: Object.fromEntries(['contracts', 'api-client', 'project-ui'].map(name => [`@living-playbooks/${name}`, fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url))])) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
