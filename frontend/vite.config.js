import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    pool: 'threads',
    isolate: true,
    // Leave capacity for the node:test suite running alongside Vitest.
    maxWorkers: '50%',
    minWorkers: 1,
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: ['three', 'lucide-react'],
        },
      },
    },
  },
  build: {
    rollupOptions: {
      input: mode === 'vworld' ? 'index-vworld.html' : 'index.html',
    },
  },
}));
