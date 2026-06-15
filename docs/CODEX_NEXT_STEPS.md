# Codex Next Steps

Give this to Codex after importing the repo:

```text
You are the tech lead for GEO Growth OS. Review the current Next.js + Supabase MVP.

Tasks:
1. Run npm install and npm run build.
2. Fix any TypeScript/build errors.
3. Add Supabase Auth with email login.
4. Add user_profiles with roles: admin, strategist, client.
5. Admin can create/edit all clients.
6. Client role can only view assigned client reports.
7. Add a background job or queue for GEO runs so 100+ questions do not timeout.
8. Add CSV export and PDF print styling for reports.
9. Add trend charts: score over time, mention rate over time, recommendation rate over time.
10. Add model_provider abstraction so we can add Perplexity, Gemini, Claude later.
11. Add audit logs for client/report access.
12. Keep gambling and crypto compliance guardrails in all prompts.
```
