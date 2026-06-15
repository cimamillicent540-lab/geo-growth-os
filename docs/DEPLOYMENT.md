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

Each run tests up to 20 questions to avoid Netlify function timeouts. Add a durable queue before expanding to 100-300 questions per run.
