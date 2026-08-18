import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative asset paths so the same build works at site root and subdirectories.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@lths/lmd/legacy': fileURLToPath(new URL('./lmd-kernel/src/compat/legacy/index.ts', import.meta.url)),
      '@lths/lmd/spec': fileURLToPath(new URL('./lmd-kernel/src/shared-kernel/index.ts', import.meta.url)),
      '@lths/lmd': fileURLToPath(new URL('./lmd-kernel/src/index.ts', import.meta.url)),
    },
  },
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
