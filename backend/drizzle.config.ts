import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs this file in its own process, so load .env explicitly.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env present — DATABASE_URL may still come from the real environment.
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env.');
}

export default defineConfig({
  schema: './src/models/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
