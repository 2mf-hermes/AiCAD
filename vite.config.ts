import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base is mandatory: the production bundle is served from an
  // embedded file origin inside WebView2 (and later from Tauri's asset
  // protocol), where absolute "/assets/..." paths do not resolve.
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'chrome110',
    sourcemap: false,
  },
  server: { port: 5510, strictPort: false },
});
