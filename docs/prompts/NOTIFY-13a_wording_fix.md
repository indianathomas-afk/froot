Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-13a_wording_fix.md and execute it.

# NOTIFY-13a — two wording bugs found in NOTIFY-13 staging tests (2026-10-24)

**TIER 2 — code fix, no schema.** Runs on `staging`. No prisma commands beyond the `prisma generate` inside `npm run build`. Commit only. Never push. PRE-PUSH-CHECK is a separate session.

## Repo gate (report each, stop on surprise)
1. `git rev-parse --abbrev-ref HEAD` → `staging`
2. `git status --short` → clean (this prompt may be the only untracked file)
3. `git log --oneline -1` → expect `69cef02`; `git log --oneline origin/staging..staging` → empty

## Bug 1 — missing space on the milestone card (regression from `aca15ad`)
On staging `/settings/notifications`, the Milestone emails card reads:
- no schedule: "At most one email a **dayto** admins and each store's managers, …"
- weekly schedule: "At most one email a **weekto** admins and each store's managers, …"

Production (pre-NOTIFY-13) reads "At most one email a day to admins and each store's managers, …". F13/C9 promised the no-schedule wording is unchanged, so this is a regression. Find where the card text is built (C9 cadence wording), restore the space, and make the no-schedule string **byte-identical** to the pre-`aca15ad` text (quote both from `git show aca15ad^:<file>` and the fixed file in the report). Check the pace card's cadence line for the same join pattern.

## Bug 2 — "Send a sample to me" ignores the saved milestone schedule
With milestones saved as Weekly (Monday, 9 AM, Pacific), the sample email's footer still reads "You get at most one milestone email **a day**." Real milestone emails carry the frequency in their payload (C5); the sample route does not. Make the sample pass the org's saved milestone frequency, so its footer reads "…a week." when weekly and stays exactly as today with no schedule row. Sample data and recipient (the clicking admin only) unchanged.

## Tests
- Add checks to `scripts/verify-notify-sched.ts` (or the fixture that already asserts milestone wording): the card cadence string for no-schedule / daily / weekly, exact text, including the no-schedule string equal to the pre-`aca15ad` text; the sample payload's footer for no-schedule and weekly.
- One negative control: re-break the space, confirm the new check fails, restore byte-for-byte.
- Re-run on dev: `verify-notify-sched` and every fixture that asserts milestone or pace wording (at least `verify-f5-polish`, `verify-ms4b`, `verify-ms6`). Report pass/fail counts.

## Commits
1. Work: `fix(NOTIFY-13a): milestone card cadence spacing; sample email follows saved schedule` — cites `aca15ad`. Gate: scoped eslint, `npm run build`, the fixtures above.
2. Docs: a dated rider on the NOTIFY-13 ROADMAP row (staging test results so far — 1 migration on staging at 2026-10-24 18:34:23Z; 2 Schedule sections render; 3 save + reload held for both cards; 5 Reset to default restored the default on both; 6 MANAGER cannot see or save schedules; 4 hand-fired cron **skipped by Gary** — the Preview `CRON_SECRET` could not be used; covered by fixture checks D3/S3 and to be confirmed on production by watching `/api/cron/scheduled-emails` in Vercel logs after promotion — plus the two bugs and this fix), and a rider on the NOTIFY-13 `UNPROMOTED` DEPLOY_LOG entry adding the fix SHA. Commit this prompt file. Heading count unchanged.

`git status` before each commit; scoped `git add` only.

## Report
Repo gate, the before/after wording quoted, fixture counts (new and re-run), negative control result, commit SHAs, prisma commands run. Then stop.
