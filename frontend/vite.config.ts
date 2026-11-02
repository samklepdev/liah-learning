import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Same-origin in dev, so the session cookie stays first-party and no CORS
  // preflight is involved. Port 5000 is unusable on macOS (AirPlay Receiver).
  server: { proxy: { '/api': 'http://localhost:3000' } }
})
