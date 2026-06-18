# Deployment

## Supabase

1. Create a Supabase project.
2. Enable email authentication in Authentication settings.
3. Copy the project URL and anon key.
4. Copy the service role key for server-side API routes only.
5. Run `supabase/migrations/20260614_geo_growth_os.sql`.
6. Confirm these tables exist:
   - `clients`
   - `user_profiles`
   - `geo_queries`
   - `geo_runs`
   - `geo_answers`
   - `geo_insights`
   - `content_tasks`
7. Confirm RLS is enabled on every table.

## First Admin

Set `GEO_ADMIN_EMAILS` to a comma-separated list of admin emails. When one of those users signs in, `/api/auth/bootstrap` creates the first `admin` profile if needed.

## Netlify

1. Push the repository to GitHub.
2. Create a new Netlify site from GitHub.
3. Build command: `npm run build`.
4. Publish directory: `.next`.
5. Ensure `netlify.toml` is committed.
6. Add environment variables in Netlify:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `APP_BASE_URL`
   - `GEO_ADMIN_EMAILS`

## Cloudflare Workers

GEO Growth OS is a Next.js full-stack app with App Router API routes. Do not deploy the raw `.next` output with plain `next build`. Use the OpenNext Cloudflare adapter.

1. Push the repository to GitHub.
2. In Cloudflare Workers & Pages, create or connect the `geo-growth-os` repository.
3. Root directory: `/`.
4. Build command: `npm run build:cloudflare`.
5. Deploy command: `npm run deploy:cloudflare`.
6. Confirm `wrangler.jsonc` is committed. It points Wrangler to `.open-next/worker.js` and `.open-next/assets`.
7. Add Cloudflare environment variables/secrets:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL=gpt-4.1-mini`
   - `APP_BASE_URL=https://your-cloudflare-workers-domain`
   - `GEO_ADMIN_EMAILS=you@example.com`
   - `INTERNAL_WORKER_SECRET=<long-random-secret>`
8. Set `APP_BASE_URL` to the real Cloudflare production URL. The async GEO worker uses this URL to call `APP_BASE_URL + "/api/runs/worker"` for the next batch.
9. Keep secrets in the Cloudflare dashboard or `wrangler secret put`; do not commit them.

Local Cloudflare checks:

```bash
npm install
npm run lint
npm run build
npm run build:cloudflare
npx wrangler deploy --dry-run
```

Local Cloudflare preview:

```bash
npm run preview:cloudflare
```

Cloudflare-specific notes:

- `wrangler.jsonc` enables `nodejs_compat` because the app uses server-side SDKs that expect Node-compatible APIs.
- The config intentionally does not require an R2 incremental-cache bucket for the MVP. Add R2 later if you need persistent ISR/cache behavior.
- The Netlify config can remain in the repo; Cloudflare uses `wrangler.jsonc` and the OpenNext output.

## Post-Deploy Checks

1. Open `/login`.
2. Sign in with an admin email.
3. Open `/dashboard`.
4. Create a client at `/clients/new`.
5. Generate GEO questions from the client detail page.
6. Run a GEO test.
7. Open the run result page.
8. Open the authenticated report page.
9. Copy and open the public share report link in a private browser session.
10. Create a client role user and confirm they only see their assigned `client_id`.

## Known MVP Limit

Each run tests up to 20 questions. The worker processes small resumable batches and self-triggers the next batch through `APP_BASE_URL`. Add a durable queue before expanding to 100-300 questions per run.
