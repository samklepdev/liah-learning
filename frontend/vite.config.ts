import react from '@vitejs/plugin-react'
// vitest/config re-exports vite's defineConfig with the `test` key typed, and
// serves dev/build identically — importing from 'vite' fails to typecheck here.
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Same-origin in dev, so the session cookie stays first-party and no CORS
  // preflight is involved. Port 5000 is unusable on macOS (AirPlay Receiver).
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Explicit imports from 'vitest' instead of globals, so eslint and tsc
    // need no extra configuration.
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
