import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, proxy API calls to the local FastAPI server.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
