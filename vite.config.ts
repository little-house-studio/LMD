import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/LTHS_MD/',
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
