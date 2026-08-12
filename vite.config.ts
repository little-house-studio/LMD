import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative asset paths so the same build works at site root and subdirectories.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: false,
  },
  server: {
    port: 5280,
    host: '0.0.0.0',
  },
});
