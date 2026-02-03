import { defineConfig } from 'vite';

// Tauri v2 expects a dev server (devUrl) and a built asset directory (frontendDist).
// We keep the existing static frontend in ./frontend and build it to ./dist.
export default defineConfig({
  root: 'frontend',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
