# Client Onboarding

## 1. Create the Client

Go to `/clients/new` and fill:

- Client name
- Website
- Industry
- Target country
- Target language
- Product description
- Core selling points
- Main competitors
- Compliance notes

For gambling clients, include:

- No minors
- No guaranteed winnings
- No false bonus claims
- No misleading withdrawal claims
- Local law and responsible gambling reminders

For crypto exchange or trading clients, include:

- No guaranteed returns
- No risk-free or principal-protected claims
- Leverage risk disclosure
- Withdrawal, security, and regulatory accuracy
- Local financial advertising rules

## 2. Generate GEO Questions

Open the client detail page and click `Generate GEO Queries`.

Review `/clients/[id]/queries` and remove questions that are off-market, legally risky, or irrelevant.

## 3. Run GEO Test

Click `Run GEO Test`.

The MVP tests up to 20 high-priority questions per run. For a full monthly audit, run multiple batches or add queue processing.

## 4. Review Results

Open `/clients/[id]/runs/[runId]` and check:

- Brand mention rate
- Recommendation rate
- Competitor mentions
- Negative or mixed sentiment
- Content gaps
- Risk notes

## 5. Share Client Report

Open `/clients/[id]/reports/[runId]`.

Use `Copy Share Link` to send `/share/reports/[shareToken]` to the client. Do not send internal dashboard URLs to client users unless they have a Supabase account and assigned profile.

## 6. Execute Content Tasks

Open `/clients/[id]/content-tasks`.

Assign owners, update briefs, and move tasks through:

- `todo`
- `in_progress`
- `done`
- `skipped`

## 7. Weekly Review

Each week:

1. Add new competitor or market prompts.
2. Run a fresh GEO test.
3. Compare visibility score, mention rate, and recommendation rate.
4. Review risk notes before publishing content.
5. Share the latest report and next action plan with the client.
