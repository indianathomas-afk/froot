Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-5b-modifier-usage.md and follow it exactly.

# N-5b — Count add-on (modifier) recipes in theoretical inventory usage

**TIER 3** (new table + migration). Declare the tier before writing anything.
Audit → STOP for Gary's rulings → plan + migration → STOP for Gary to apply to dev → build → fixtures → commit. Never push.

## Where things stand
- Production (main) = `6d2cb1f`. Staging = `2d891ea` (6d2cb1f + docs-only BUG-20 promotion stamp).
- Work on `staging`. Project knowledge reflects main only — read the actual files, never assume.
- All 67 `scripts/verify-*.ts` fixtures green at start. Confirm that before Step 2.
- ORDERS_READ is already granted. Froot is read-only from Square. Do not change OAuth scopes.

## What this does, in shop language
Today a smoothie sold counts its own recipe toward theoretical usage. Add-ons don't count. A whey boost doesn't use any whey; "no banana" still uses a banana.
After N-5b, every Square order line's modifiers count their modifier recipes too, scaled by cup count.

## Facts from the N-5 audit (verify each against the code; flag anything that's wrong)
1. 595 Square modifiers are synced; 127 modifier recipes are imported from BevSpot (Las Brisas file).
2. Negative recipe lines exist only on modifier recipes (removals like "no banana").
3. Modifier quantity is **per unit of the line**. A line of 2 smoothies with 1 whey boost means 2 whey boosts.
4. A removed default-on modifier arrives as **quantity 0**.
5. The new cache table is written inside the **BUG-7 guarded write**.
6. Five consumers read theoretical usage. Find all five and list them by file path.

## HARD REQUIREMENT — no double counting
Each `syncSalesForStore` call re-reads the whole store-day from Square, and webhooks fire several times per order. Production on 2026-11-04 showed bursts of 2–3 syncs within 200 ms for the same store.
The modifier usage write must **replace** that store-day's rows on every sync. It must never append.
The fixture must prove it: run the same day's sync 3 times and show identical usage totals.

## Step 1 — Gary ratifies (STOP)
Show Gary these questions. Wait for his answers and record them in `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` **in his words**.
- **Speed follow-up from the 11-04 production logs**: BUG-20/21 status, a BUG-22 row (webhook burst / full-day re-read), and stamping `6d2cb1f` with the 11-04 production timing lines.
- **R1 History**: count forward from ship day only, or backfill past days? (Report the cost of a backfill in the audit.)
- **R2 Refunds**: Square sends refunds as separate return orders (return line items + return modifiers). Count sales only and note refunds as a gap, or subtract returns now?
- **R3 Unmapped modifiers** (synced but no recipe): skip and show a count, or something else?
- Any other ruling the audit needs.

## Step 2 — Audit (read-only, no edits)
Report with full absolute file paths:
- Where order line items are fetched and whether modifiers (`catalog_object_id`, `quantity`) are already captured or dropped.
- The BUG-7 guarded write: how it works and where the new table's write fits.
- The five consumers and how each would pick up modifier usage.
- How a Square modifier ID maps to a Froot modifier recipe. How many of the 595 have a recipe; list the unmapped ones by count only.
- Unit math end to end: line quantity × modifier quantity × recipe line amount, including negative lines and quantity 0.
- Backfill cost for R1: how many Square calls and what volume per store-day.
- Returns: what the current sync does with return orders today.
- Proposed table (name, columns, unique key that makes replace-per-store-day safe).

**STOP. Wait for Gary's go.**

## Step 3 — Plan + migration
- Write the plan in the session report.
- Generate the migration file. **STOP after generating it.** Gary applies it to dev himself with `npx prisma migrate deploy` and says go. Do not run any prisma migrate command.

## Step 4 — Build
- Smallest change that meets the rulings. Match existing patterns.
- Add `scripts/verify-n5b-*.ts` fixture(s) covering: add-on counted × cup count; quantity 0 skipped; negative line subtracts; unmapped modifier skipped and counted; **3 identical syncs → identical totals**; R2 behaviour as ruled.
- Run all fixtures. Everything must be green.

## Step 5 — Commit
- Stage only the files this session touched. No `git add -A`.
- Code commit first, then a docs commit (ROADMAP row, DECISIONS, DEPLOY_LOG marked unpromoted). That gives two SHAs.
- Do not push.

## Out-of-scope findings
Classify each finding as FIX NOW / RULING NOW / COMMENT / ROW before the report. ROW is the last resort.

## Session report
Tier, both SHAs, fixture count and result, rulings recorded (quoted), files touched (absolute paths), and anything Gary must do next.
