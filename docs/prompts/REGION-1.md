# REGION-1 — Run Froot's functions next to its database (iad1 → pdx1) — TIER 2

TIER 2: deployment configuration only; no schema, no app behaviour change.
Plan-first with one STOP. Work commit (config), then docs commit citing it.
`npm run build` gates commits. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/REGION-1.md`.

## Why

N-5-SYNC's audit (2026-11-03) found the Vercel project runs functions in
**iad1** (Washington, D.C., US East) while every Neon endpoint is in
**us-west-2** (Oregon): dev `ep-late-water-a6k53nv2`, staging
`ep-odd-rain-a6gr4xmm`, production `ep-green-smoke-a6xthq4r`. Every database
round trip crosses the country (estimated ~70 ms, not measured). Vercel's
**pdx1** (Portland, Oregon) is the AWS us-west-2 region — the same region as
the database. Moving functions there should cut that latency for every page,
API route, cron and sync.

## Phase 0 — repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `85a5b42` or later.
`git log --oneline -3`. Only this session writes to the repo.

## Phase 1 — audit and measure (read-only), then STOP

Write `docs/prompts/REGION-1_AUDIT.md`.

A. **Where the region is set today:** `vercel.json`, `next.config.ts`,
   per-route `export const preferredRegion`, and the project setting (read via
   `npx vercel project inspect` / the projects API, as N-5-SYNC did — settings
   only, never secrets). Which wins, per Vercel's current docs (cite them).
B. **Confirm the database region:** each Neon endpoint's region, from the
   connection hosts in docs/CLAUDE.md (no database connections).
C. **Everything else the functions talk to,** and whether any is region-bound:
   Vercel Blob stores (HR, nutrition `froot-nutrition` iad1, others), Square,
   Clerk, Resend, Anthropic, Instagram, cron. Blob stores are created in a
   region; note whether reading a private iad1 blob from pdx1 matters (latency
   only, or anything else).
D. **Middleware/proxy** (`src/proxy.ts`): where it runs, and whether it's
   affected.
E. **Baseline measurement:** from the Vercel runtime logs (Preview and
   Production), the current duration of a few representative routes —
   `/api/square/sales-items/sync` (its `[sales-items/sync]` line), the
   dashboard, `/inventory/ingredients`, `/nutrition/menu`. If logs don't carry
   durations, say how Gary can read them (log details / Observability) and
   give him the exact steps; don't guess numbers.
F. **Plan:** the smallest change, lean — `"regions": ["pdx1"]` in
   `vercel.json` (tracked in git, applies to Preview and Production) unless the
   docs say the project setting overrides it; any per-route `preferredRegion`
   to remove; rollback = revert the commit.

**Forks — chat's leans; Gary rules at the STOP:**

- **REGION-F1:** pdx1 for all functions (Preview and Production).
- **REGION-F2:** set it in `vercel.json` (in git), not only in the dashboard.
- **REGION-F3:** leave Blob stores where they are (moving them is a separate
  data migration); note any cost/latency for the record.

**STOP** with the audit, the baseline numbers (or Gary's steps to read them),
and the plan. No change before Gary's go.

## Phase 2 — change (after Gary's go)

Make the config change as ruled. Nothing else.

- `npm run build` must pass.
- No fixture is needed for a config change; re-run nothing unless a file under
  `src/` changed (it shouldn't).

## Commits

Work commit (config only). Docs commit: a ROADMAP row for REGION-1 (read the
file for conventions and the next free id) at `in_progress` with the work SHA;
DECISIONS — Gary's rulings in his words, DRAFT; a DEPLOY_LOG note is written by
the PRE-PUSH-CHECK, not here; commit this prompt and the audit.

## Report and stop

Work SHA, docs SHA, the exact config diff, and a test plan:

1. After the staging deploy, confirm in Vercel (deployment → Functions) that
   functions run in **pdx1**.
2. Click through sign-in, dashboard, Ingredients, a recipe, Menu Nutrition, a
   label, Label Inbox, Public Menu, an HR page, Messages — all normal.
3. Run **Sync from Square** on staging; compare the `[sales-items/sync]`
   duration with the baseline.
4. Compare the other baseline routes' durations.

Do not push.
