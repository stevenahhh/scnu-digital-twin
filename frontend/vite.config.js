import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react(), cinematicCapturePlugin()],
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
