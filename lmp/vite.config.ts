import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: false,
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
});
