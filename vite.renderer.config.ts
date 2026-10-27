import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // #9926: registered port (Q:/Pantheon/config/services.json miditutor/renderer). strictPort: a busy port is
  // an error, never a silent drift to the next one (that drift hid five copies on 5173-5177, 2026-10-26).
  // An e2e run beside a dev copy picks its own with MIDITUTOR_VITE_PORT.
  server: { port: Number(process.env.MIDITUTOR_VITE_PORT ?? 5181), strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
