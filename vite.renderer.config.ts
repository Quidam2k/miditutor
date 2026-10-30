import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { version } from './package.json';

// package.json stays 0.1.0, so the commit is what tells two builds apart (#5259).
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(`${version} (${buildSha()})`) },
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
