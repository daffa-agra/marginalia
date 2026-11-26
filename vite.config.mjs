import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plain ESM config (not .ts) so Vite loads it natively — esbuild's config
// bundler walks up the directory tree and fails on locked package.json
// files above the project (access-denied at the user profile root).
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tooling/temp dirs (review agents, backups) drop locked .tmp files
      // that crash chokidar with EBUSY — none of these affect the app.
      ignored: ['**/.review/**', '**/dist-backup/**', '**/dist/**', '**/smoke/**', '**/*.tmp'],
    },
  },
});
