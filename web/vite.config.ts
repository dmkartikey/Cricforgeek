import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is set by the deploy workflow (e.g. "/cricforgeek/" on GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 800 },
});
