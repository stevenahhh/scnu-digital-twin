import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { precompressedAssetMiddleware } from './scripts/campus-model/serveCompressed.mjs';

// campus-v2.glb from its .br/.gz copy when the publish gate (bun run model:build --precompress) wrote one that is still fresh.
// The dev server reads public/, the preview server the build output it serves.
function precompressedModelPlugin() {
  const names = ['campus-v2.glb'];
  return {
    name: 'scnu-precompressed-model',
    configureServer(server) {
      server.middlewares.use(precompressedAssetMiddleware(fileURLToPath(new URL('./public', import.meta.url)), names));
    },
    configurePreviewServer(server) {
      server.middlewares.use(precompressedAssetMiddleware(resolve(server.config.root, server.config.build.outDir), names));
    },
  };
}

function cinematicCapturePlugin() {
  return {
    name: 'scnu-cinematic-capture',
    configureServer(server) {
      server.middlewares.use('/__cinematic-capture', async (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        try {
          const contentType = request.headers['content-type'] ?? '';
          const extension = contentType.startsWith('video/mp4') ? 'mp4' : 'webm';
          const outputPath = fileURLToPath(
            new URL(`../scnu-real-drone-campus-loop-60s-live.${extension}`, import.meta.url),
          );
          await pipeline(request, createWriteStream(outputPath, { flags: 'w' }));
          response.statusCode = 204;
          response.end();
        } catch (error) {
          server.config.logger.error(`Cinematic capture could not be saved: ${error.message}`);
          response.statusCode = 500;
          response.end('Cinematic capture could not be saved.');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), cinematicCapturePlugin(), precompressedModelPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./src/test/domPolyfills.js'],
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
      input: mode === 'vworld'
        ? 'index-vworld.html'
        : mode === 'solar'
          ? 'index-solar.html'
          : mode === 'paper'
            ? 'index-paper.html'
            : 'index.html',
    },
  },
}));
