import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${process.env.CAR_DEMO_PORT ?? 8003}`,
        ws: true,
      }
    }
  }
})
