import { execSync } from 'node:child_process';

// Vercel runs this service's buildCommand for every deployment, including
// previews. Previews point at their own disposable Neon branch (see
// .github/workflows/neon_workflow.yml) where a schema mismatch is harmless,
// but only the production build should touch the shared prod database.
if (process.env.VERCEL_ENV === 'production') {
  execSync('npx drizzle-kit migrate', { stdio: 'inherit' });
} else {
  console.log(`Skipping db:migrate — VERCEL_ENV is "${process.env.VERCEL_ENV ?? 'unset'}", not "production".`);
}
