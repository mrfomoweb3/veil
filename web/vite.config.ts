import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Gloam's relay sends no CORS headers; in dev the browser reaches it through this proxy.
    proxy: { '/gloam-relay': { target: 'https://www.gloam.trade', changeOrigin: true, rewrite: () => '/api/relay' } },
  },
  resolve: { alias: { assert: fileURLToPath(new URL('./src/shims/assert.ts', import.meta.url)) } },
  worker: { format: 'es' },
  // The vault is lazy-loaded; listing its deps up front stops Vite re-optimizing mid-session
  // (which leaves the page importing stale chunks) the first time someone opens it in dev.
  optimizeDeps: { include: ['@noble/curves/secp256k1', '@noble/hashes/sha3', '@noble/hashes/utils', 'viem', '@gloamtrade/sdk'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
