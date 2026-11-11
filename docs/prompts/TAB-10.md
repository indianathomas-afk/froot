Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-10.md and follow it.

# TAB-10 — Transactions and average sale in the tablet's expanded Sales card

**TIER 2.** A display change on one tablet card, plus at most a few extra fields in an existing route's answer. No schema, no migration, no new Square call, no permission change, no env var, no cron. Declare the tier before writing anything. **Escalate to TIER 3 and STOP** if an escalation trigger fires.

## Repo gate

- Repo: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `staging`.
- The tree must be clean apart from this prompt (untracked). Report `git log --oneline -1`, `origin/staging` and `main`. Re-check `origin/staging` right before committing.
- Staging carries TAB-4, TAB-8 and TAB-7, pushed but **not promoted**. TAB-10 stacks on top.
- Read the TAB-10 row in `docs/ROADMAP.yaml` before writing. Never assume the "next free" id.

## The ask (plain English)

The desktop Sales card already shows Transactions and Average sale, each compared with last year at the same time of day (TAB-7). The tablet's expanded Sales card (TAB-9) shows only dollars. TAB-10 adds the same two numbers to the tablet, using the same maths, so a manager at the counter sees "9 transactions · $11.88 average" and how that compares with last year.

## Settled, not open for ruling

- **The comparison uses TAB-7's same-time basis and helper** (`src/lib/sales-same-time.ts`). "Last year" means the same weekday (today − 364). Don't write a second calculation.
- **Definitions match the desktop card exactly.** Transactions is the order count. Average sale is net sales ÷ transactions. If desktop computes either one differently, use desktop's version and say so.
- **No new Square calls.** Read the caches only.

## Phase 1 — brief audit (report it; continue unless a trigger fires)

1. **Desktop's source.** How the desktop card gets Transactions and Average sale, and their same-time comparisons: route, fields and helper calls.
2. **Tablet's source.** What `/api/dashboard/summary` returns to the tablet strip and the expanded card today, and whether it already carries order counts (today and the comparison day, same-time and whole day).
3. **Where the rows go.** The expanded card's current rows: today so far, same weekday last year by time, whole day, and the hour-by-hour table. Is there room on an iPad?

### Escalation triggers (STOP, report, wait for rulings)

- Transactions and average sale would need a figure the caches don't hold.
- The two surfaces would have to share a route change that alters what desktop shows.
- More than the summary route's answer and the expanded card would have to change.

## Draft leans (Claude's design choices, ratified at PRE-PUSH-CHECK)

1. **Two rows in the expanded Sales card, below the dollar rows:** "Transactions" and "Average sale". Each shows today's figure and a ▲/▼ against last year at the same time, with the same pill style and "—" rule as the headline. If last year's same-time figure is 0, show "—", not a percentage.
2. **The collapsed tile is unchanged.** It stays one line: dollars and the headline comparison.
3. **Use the same fields and helper as desktop.** If the summary route needs extra fields, add today's order count and the same-time comparison order count. Desktop's numbers must not move.
4. **Past days and the whole-day row are unchanged.**
5. **It refreshes on the existing cycle** (TAB-5 and TAB-8). No new timer.
6. **Optional, only if trivial:** add a Transactions column to the hour-by-hour table, using the hourly cache's `orderCount`. If it crowds the iPad layout, skip it and say so.

## Build

- Code, then the fixture `scripts/verify-tab10.ts`. It must cover:
  - the summary route returns the order counts (structural, with a negative control);
  - the expanded card renders both rows from the route's answer, not from props (structural, with a negative control);
  - average sale = net ÷ transactions, with 0 transactions → "—";
  - the tablet's numbers equal desktop's for the same store and moment (database check on dev, read-only);
  - desktop's route output is unchanged.
- Re-run and report counts: TAB-1, TAB-1c, TAB-2, TAB-3, TAB-4, TAB-5, TAB-7, TAB-8, TAB-9, plus `verify-goal-engine`, `verify-f4-rollup-webhook` and `verify-bug20`. `npm run build` must be green; run scoped eslint.
- Local check: if you need a temporary page, delete it before committing.

## Commits (never push)

- Stage only the files this session touched. No `git add -A`.
- **Work commit:** `feat(TAB-10): …`
- **Docs commit:** `docs(TAB-10): …`. It covers the ROADMAP TAB-10 row (`in_progress`, work SHA, staging tests) and a DRAFT DECISIONS entry listing the leans as built. Leave this prompt untracked; PRE-PUSH-CHECK folds it in.

## Report

- TIER, repo gate, audit answers 1–3, and whether any trigger fired.
- What changed, the leans as built, and any departures, each marked "(design choice)".
- Fixture counts, build and eslint.
- Findings, classified FIX NOW / RULING NOW / COMMENT / ROW.
- Both SHAs and `git log @{u}..`. End with "Committed, NOT pushed."
