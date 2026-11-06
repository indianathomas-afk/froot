Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-5e-addon-import-audit.md and follow it exactly.

# N-5e — Why the BevSpot add-on recipe import never saved, and the plan to fix it

**TIER 2, audit first.** Declare the tier before writing anything. If the fix needs a schema change, stop and say it's TIER 3.
Audit → STOP for Gary's rulings → plan → STOP → build (only if code is needed) → fixtures → commit. Never push.
**No writes to staging or production databases from this session.** Gary does any applying himself, through the app.

## Where things stand
- Run only after the N-5b PRE-PUSH-CHECK is finished and staging is pushed. One session on the repo at a time.
- N-5b is on staging (code `835a847`, docs `1bc285e`). Read the actual files; project knowledge reflects main only.
- Run all fixtures at the start and report the count. It should be 69.

## Measured 2026-11-04 by Gary in the Neon console (do not re-cite; these are the evidence)
- **Production** (`br-sparkling-block-a620qvg4`, org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`): 595 Square add-ons, all live, 0 with a recipe. 438 recipes, **all created 2026-11-01 (UTC)**, 0 linked to an add-on, **0 negative recipe lines**.
- **Staging** (`br-square-feather-a63z92vz`, org `cmr54z65v000105jxczpt72w1`): 595 add-ons, 0 with a recipe. **3 recipes total**, 0 linked, 0 negative lines.
- **Dev** (`br-broad-wave-a6vpjdw0`): 0 add-ons, 0 add-on recipes (from the N-5b audit).
- DEPLOY_LOG for N-5 records "31 recipes ready + 127 modifier recipes (+6 prep)", with 158 applied **as relayed by Gary**. No recipe was created on any branch on 11-02 or 11-03, so the 158 did not save.

## In shop language
We built the add-on recipes ("Whey boost", "No Banana") from the Las Brisas BevSpot file, and the preview showed them ready. None of them exist in the database. Until they do, N-5b counts no add-ons anywhere. Find out why, and plan how to get them in.

## Step 1 — Audit (read-only)
Report with full absolute file paths:
1. **The apply path end to end.** The BevSpot preview → apply flow (`apply/route.ts` and what it calls). Does it write in one transaction? What happens if one recipe fails (a bad unit, a name that matches more than one thing, a negative line)? Does the whole apply roll back, and does the screen tell the user?
2. **Could the apply have "succeeded" without saving?** Check the success message, the response shape, and any early-return paths. Name every way a user could see success with 0 rows written.
3. **Linking.** How an add-on recipe gets its `squareModifierId` link. What happens when the Square add-on row doesn't exist yet: is the recipe skipped, saved unlinked, or does the apply fail?
4. **Can the catalog sync break links?** Does N-5-SYNC (batched catalog sync) ever delete and recreate `SquareModifier` rows, giving them new IDs, and what does the foreign key do on delete? This isn't the cause today, since nothing was ever linked, but it would silently break links after a fix.
5. **The 11-01 import.** What created the 438 production recipes on 2026-11-01, and why staging didn't get them. Is there a supported way to bring the same library to staging?
6. **The known hand-fix.** "Pitaya (Dragon Fruit)" name-matches more than one thing in BevSpot (1 recipe). Could that one row block the whole apply?
7. **Logs.** Which log lines, if any, the apply writes, so Gary can check Vercel for 11-02 / 11-03 attempts.

Give Gary **read-only Neon queries** for anything you can't settle from code. Every query must print `current_setting('neon.branch_id', true)` in its output. No writes.

## Step 2 — Rulings (STOP)
Show Gary the cause (or the best-supported cause, labelled as such) and these questions, plus anything the audit adds. Record his answers in `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` **in his words**:
- **E1 Staging seed.** How staging gets the recipe library so it can test recipe features.
- **E2 Re-run order.** Staging first, confirm, then production (the nutrition-series rule), or something else?
- **E3 Code fix.** If the apply can report success without saving, or can't survive one bad row, fix it now, or re-run by hand first?
- **E4 Link safety.** If the catalog sync can break links, guard it now or file a row?

## Step 3 — Plan (STOP)
The smallest plan that meets the rulings. If code is needed: files, the fixture that proves it (including that a failed row is reported, never silent), and the expected fixture count. **STOP for Gary's go.**

## Step 4 — Build (only if the plan has code)
Match existing patterns. Add `scripts/verify-n5e-*.ts`. Run all fixtures; everything must be green. Lint and build green.

## Step 5 — Commit
Stage only the files this session touched. No `git add -A`. Code commit, then a docs commit (ROADMAP row, DECISIONS, DEPLOY_LOG marked unpromoted). Two SHAs. If there's no code, the session makes one docs commit and says so. Do not push.

## Out-of-scope findings
Classify each as FIX NOW / RULING NOW / COMMENT / ROW before the report. ROW is the last resort.

## Session report
Tier, SHAs, fixture count and result, the cause, rulings recorded (quoted), files touched (absolute paths), and **Gary's exact steps to get the add-on recipes in on staging, then production**.
