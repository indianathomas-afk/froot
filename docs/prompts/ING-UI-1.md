# ING-UI-1 — Ingredients table: split Category / GL Code, de-duplicate Pack — TIER 1

TIER 1: display-only change to the Ingredients list page. No schema, no API
changes, no data writes. One work commit, one docs commit citing it.
`npm run build` gates commits; lint does not (DEBT-33). Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/ING-UI-1.md`.

## Why

Found by Gary on staging, 2026-11-01, after importing Meadowood's 212
ingredients (BevSpot library → Froot CSV import):

1. The Category cell renders category and GL together:
   `Cups / Lids / Straws · GL 5035`. Gary wants two columns.
2. The Pack cell renders `package (package (200 ea))`. The imported
   `packDescription` already begins with the purchase unit, and the table
   prefixes `purchaseUnitLabel` again.

## Phase 0 — repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. Otherwise STOP.

```
git status
```
→ on `staging`, tree clean. Any untracked BEV-1 files mean BEV-1's pause
commit hasn't landed: STOP and tell Gary.

```
git log --oneline -3
```

## Phase 1 — locate (read-only), then build

Find the Ingredients list table (`src/app/(app)/inventory/ingredients/` and its
table component). Report the file and the lines that render the Category and
Pack cells, and how the GL value is derived today (override vs category).

Build:

1. **Category column** shows the category name only (subcategory as it shows
   today, if it does).
2. **New GL Code column**, immediately right of Category. Shows the effective
   GL: `glCodeOverride` if set, else the category's `glCode`, else `—`. When the
   value comes from the override, append a small muted "override" label. Reuse
   whatever helper computes the effective GL today; do not add a second rule.
3. **Pack cell**: if `packDescription` (trimmed, case-insensitive) already
   starts with `purchaseUnitLabel`, render `packDescription` alone; otherwise
   keep today's rendering. Pure display; no write.
4. Column widths stay usable at the current layout; long names still wrap.

Scope is this one table. If the same merged Category/GL rendering appears
elsewhere (counts, POs, exports), list the locations in the report as ROW
candidates. Do not change them.

STOP and ask Gary if the GL derivation isn't a single obvious rule (RULING NOW).

## Commits

1. Work commit. Stage only the files touched.
2. Docs commit citing the work SHA: ROADMAP row `ING-UI-1` (read the file for
   the convention; status `in_progress` with the work SHA), and this prompt
   committed.

## Report and stop

Work SHA, docs SHA, files touched, `npm run build` result, and a plain-English
before/after for both cells. Do not push.
