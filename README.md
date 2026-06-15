# GEO Growth OS

GEO Growth OS is a B2B SaaS MVP for AI search visibility audits. It helps agencies and growth teams measure whether a client brand is mentioned, recommended, outcompeted, or described with risk in ChatGPT-style AI answers.

The first commercial use cases are online casino, crypto exchange, ecommerce, SaaS, fintech, and cross-border service clients.

## Features

- Supabase Auth email login and role-based access.
- Roles: `admin`, `strategist`, `client`.
- Client project management.
- AI-generated GEO query libraries.
- OpenAI-powered GEO test runs, limited to 20 questions per MVP run to avoid serverless timeouts.
- Structured answer analysis: brand mention, brand position, competitors, sentiment, recommendation status, citations, content gaps, and risk notes.
- Client-ready reports with public share links using `share_token`.
- Content task generation for FAQ, comparison pages, blogs, landing pages, reviews, Reddit / Quora answers, and ad creative angles.
- Supabase RLS policies that keep client users scoped to their assigned `client_id`.
- Print-friendly report pages for browser PDF export.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Supabase Auth, Postgres, RLS
- OpenAI API
- Netlify Next.js runtime

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
APP_BASE_URL=http://localhost:3000
GEO_ADMIN_EMAILS=you@example.com
```

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser. Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` server-side only.

## Supabase Setup

1. Create a Supabase project.
2. Enable email auth in Supabase Auth.
3. Run `supabase/migrations/20260614_geo_growth_os.sql` in the SQL Editor or with the Supabase CLI.
4. Add your first admin email to `GEO_ADMIN_EMAILS`.
5. Sign in with that email. The app bootstraps a matching `admin` profile on first login.
6. Admins can add more users by creating rows in `user_profiles`.

## Roles

- `admin`: all clients, create/edit/delete clients, run GEO tests, manage content tasks, manage `user_profiles`.
- `strategist`: all clients, generate queries, run GEO tests, view reports, manage content tasks, cannot manage users.
- `client`: only assigned `client_id`, view project and reports, cannot run tests or edit data.

## Netlify Deployment

1. Push the repo to GitHub.
2. Create or link a Netlify site.
3. Configure environment variables in Netlify.
4. Build command: `npm run build`.
5. Publish directory: `.next`.
6. Keep `@netlify/plugin-nextjs` enabled through `netlify.toml`.

## Main Routes

- `/login`
- `/dashboard`
- `/clients`
- `/clients/new`
- `/clients/[id]`
- `/clients/[id]/queries`
- `/clients/[id]/runs/[runId]`
- `/clients/[id]/reports/[runId]`
- `/clients/[id]/content-tasks`
- `/share/reports/[shareToken]`

## Common Issues

- `No user profile assigned`: add the email to `GEO_ADMIN_EMAILS` for first admin bootstrap, or create a `user_profiles` row as an admin.
- `Missing Supabase env vars`: check `.env.local` locally or Netlify environment variables.
- `OpenAI did not return valid JSON`: retry the run; prompts request JSON, but transient model formatting can still fail.
- Netlify function timeout: MVP runs only 20 queries per run. Add a queue before scaling to 100-300 questions.
