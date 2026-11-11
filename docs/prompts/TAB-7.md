Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-7.md and follow it.

# TAB-7 — Today's sales vs last year at the same time of day

**TIER 2.** This is a display and query change that reads only caches Froot already has. No schema, no migration, no new Square call, no permission change, no env var, no cron. Declare the tier before writing anything. If any escalation trigger below fires, **escalate to TIER 3 and STOP**.

## Repo gate

- Repo: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `staging`.
- The tree must be clean apart from this prompt, which is untracked. Report `git log --oneline -1`, `origin/staging` and `main`.
- Staging carries TAB-4 and TAB-8, pushed but **not promoted**. TAB-7 stacks on top of them.
- Read the TAB-7 row in `docs/ROADMAP.yaml` before writing. Never assume the "next free" id.

## The problem (plain English)

At 8 AM the Sales tile reads "$27 ▼97.9%" because it compares this morning's sales with last year's *whole day*. Until close, the percentage tells a manager nothing. TAB-7 compares today-so-far with last year **up to the same time of day**, so "▼12%" at 10 AM means 10 AM was actually 12% behind.

## Settled, not open for ruling

- **"Last year" means the same weekday: today − 364 days.** This is Froot's existing convention (`docs/FORECASTING.md`, the goal basis, and `/api/dashboard/summary`'s comparison). Keep it.
- **Net sales follows FORECASTING.md's definition:** paid orders, bucketed by `created_at`, store-local. Don't redefine it.
- **Don't add Square calls.** BUG-20 and BUG-21 are open on exactly this duplicated-fetch path. Read caches. Any gap-fill must use the existing `ensureSalesCached` path with its `caller` label, not a new fetch.

## Phase 1 — brief audit (report it; continue unless a trigger fires)

1. **Every surface showing a today-vs-last-year sales comparison.** Include at least the desktop dashboard Sales card, the tablet strip's Sales tile, TAB-9's expanded Sales detail, and the All-locations rollup if it shows one. For each, give the route and field it reads, and what the comparison is measured against today.
2. **`SalesHourlyCache` coverage for the comparison day.** Is it written on the same sync and backfill paths as `SalesPeriodCache`? Is it bucketed the same way (`created_at`, store-local hour)? The schema comment still says closed_at. If the two caches use different bucketing, say so. On dev and from code, does a backfilled last-year day have hourly rows?
3. **What happens when the comparison day has a period row but no hourly rows.** For example, a day cached before hourly existed, or a partial backfill.
4. **Store-local "now".** How the routes get the store's timezone and current local time today. Also how DST is handled, since an hour bucket is store-local on both days.

### Escalation triggers (STOP, report, wait for rulings)

- Last year's hourly rows don't exist for most stores, so TAB-7 would need a backfill, a migration or new Square calls.
- `SalesHourlyCache` and `SalesPeriodCache` bucket differently in a way that makes hourly sums disagree with the day total.
- More than the comparison maths and its labels would have to change.

## Draft leans (Claude's design choices, ratified at PRE-PUSH-CHECK)

1. **The comparison number, when the selected day is today.** Last year's sales by now = the sum of last year's hourly `netSales` for every hour before the current store-local hour, plus the current hour's `netSales` × (minutes past the hour ÷ 60). Compare today's live net sales against that.
2. **Past days and future days are unchanged.** A finished day still compares with last year's full day.
3. **One shared helper** in `src/lib/` (for example, `sales-same-time.ts`), used by every surface from audit item 1. That way the desktop card, the tablet tile and the rollup can't disagree. Rollup: sum each store's same-time figure. Never average percentages.
4. **The label says what it compares with:** "vs last year by 10:15 AM" on today, and the existing wording on past days. Keep it short enough for the tablet tile.
5. **No meaningful comparison means no percentage.** If last year's figure by now is $0, as before opening or for a new store, show "—", never ∞% or ▼100%.
6. **Missing hourly rows fall back honestly.** If the comparison day has a period row but no hourly rows, keep today's full-day comparison and label it "vs last year (full day)". Never mix the two methods inside one rollup total: a store without hourly rows drops out of the rollup's same-time sum and is counted in a small "n stores without hourly data" note.
7. **The tile refreshes on its existing cycle** (TAB-5 and TAB-8). No new timer. The same-time figure moves as the clock moves.
8. **Use the store's timezone, never the server's.** DST is handled by bucketing on store-local hours, with no hour shifting. Note this as a known limit in the DECISIONS draft.
9. **Goal and pacing maths are untouched** (`src/lib/pacing.ts`, the Monthly Goal card, projections). TAB-7 changes only the last-year comparison.

## Build

- Code, then the fixture `scripts/verify-tab7.ts`. It must cover:
  - the helper's maths: hour boundaries, partial current hour, before opening ($0 → "—"), and after close equalling the full day;
  - past days still compare full days;
  - the fallback when a day has a period row but no hourly rows, including the rollup's drop-out and its count;
  - store-local time across two timezones;
  - every surface from audit item 1 calling the shared helper (structural, with negative controls);
  - no new `syncSalesForStore` or orders-search call site (structural);
  - database checks on dev: the hourly sum for a full past day equals its period-cache net within a cent, or report the gap.
- Re-run and report counts for TAB-1, TAB-1c, TAB-2, TAB-3, TAB-4, TAB-5, TAB-8, TAB-9, plus any sales or goal fixtures the touched files are covered by (for example `verify-goal-engine`, `verify-f4-rollup-webhook`, `verify-bug20`). `npm run build` must be green, and run scoped eslint.
- Local check: if you use a temporary page, delete it before committing.

## Commits (never push)

- Stage only the files this session touched. No `git add -A`.
- **Work commit:** `feat(TAB-7): …`
- **Docs commit:** `docs(TAB-7): …`. It contains the ROADMAP TAB-7 row (`in_progress`, work SHA, staging tests) and a DRAFT DECISIONS entry listing the leans as built. Leave this prompt untracked; PRE-PUSH-CHECK folds it in.

## Report

- TIER, the repo gate, audit answers 1–4, and whether any trigger fired.
- The surfaces changed, the helper, the leans as built, and any departures, each marked "(design choice)".
- Fixture counts, build and eslint results.
- Findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Both SHAs and `git log @{u}..`. End with "Committed, NOT pushed."
