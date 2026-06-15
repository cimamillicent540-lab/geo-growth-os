# GitHub Workflow

## Branches

- `main`: production branch connected to Netlify production deploys.
- `feature/<short-name>`: feature work.
- `fix/<short-name>`: bug fixes.
- `docs/<short-name>`: documentation-only changes.

## Pull Request Flow

1. Create an issue for product or bug work.
2. Branch from `main`.
3. Keep changes scoped to one feature or fix.
4. Run `npm run build` before opening the PR.
5. Open a PR using `.github/pull_request_template.md`.
6. Request code review.
7. Confirm Netlify preview deploy.
8. Merge to `main` after approval.

## Code Review Checklist

- Authentication and role checks are enforced.
- Client users cannot access another `client_id`.
- Server-only keys are not used in client components.
- Gambling and crypto compliance guardrails are preserved.
- Report share links use `share_token`, not backend session permissions.
- UI remains B2B SaaS and readable on mobile.

## Migration Rules

- Every schema change must be committed as a SQL migration under `supabase/migrations`.
- Enable RLS on any table in the public schema.
- Add grants and policies in the same migration.
- Do not use user-editable metadata for authorization.
- Review changes against Supabase security guidance before merge.

## Environment Variables

Never commit `.env`, `.env.local`, service role keys, OpenAI keys, or Netlify tokens. Use `.env.example` for names only.
