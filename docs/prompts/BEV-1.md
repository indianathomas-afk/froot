# BEV-1 — BevSpot recipe import (Nutrition series, session 1 of 5) — TIER 3

TIER 3: bulk writes into org-level inventory assets (Recipe, RecipeLine,
SalesItem.recipeStatus) plus a new ADMIN route. Plan-first. One phase, no riders.
Two-commit pattern (work, then docs citing the work SHA). `npm run build` gates
commits; lint does not (DEBT-33). Never push. Never write to Square.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BEV-1.md`.

---

## Why this session exists (read before anything else)

Gary wants the Nutrition pillar built (N-1 → N-3 plus an HTML export). Planning
in chat on 2026-10-31 found three things that reorder the work:

1. **Froot already has one-recipe-for-all-stores.** `Recipe`, `RecipeLine` and
   `Ingredient` (I-6) are org-scoped; a recipe attaches to a `SalesItem` by
   Square variation ID, and Square variation IDs are merchant-wide. BevSpot's
   per-store recipe flaw does not exist in Froot. Nothing to build for that.
2. **The original nutrition tables are a disconnected stub.** `MenuItem`,
   `MenuItemNutrition`, `MenuItemAllergen` (init migration) hold hand-typed
   numbers per menu item with no link to `SalesItem` or `Recipe`. Building
   screens on them means typing nutrition per item and watching it go stale
   every time a recipe changes. Chat's lean (ruling owed — see F1): nutrition
   lives on **ingredients** and is **computed through recipes**, the same way
   `src/lib/recipe-cost.ts` computes cost. The stub tables are left untouched.
3. **BevSpot has recipes but no nutrition.** Nutrition has to be entered once
   per food ingredient (N-1). Recipes have to exist first, so the import comes
   first. That is this session.

Proposed series (filed as rows in this session's docs commit — F6):
- **BEV-1** (this) — import BevSpot recipes into Froot's org-level recipes.
- **N-1** — ingredient nutrition + allergens, computed nutrition engine,
  menu manager page showing each Square item's computed nutrition and
  completeness ("11 of 12 ingredients have nutrition").
- **N-2** — FDA-style Nutrition Facts label preview per item/size, optional
  per-item override, publish toggle.
- **N-3** — public menu page (no login) with nutrition + allergens, embeddable
  on the website.
- **N-4** — static HTML export of the public menu for sites that can't embed.
- **BEV-2** (planned) — BevSpot prep/batch recipe import, if F4 needs it.

If `docs/ROADMAP.yaml` already holds N-1/N-2/N-3 rows with other scopes,
rescope them with dated riders (preserve-and-mark). Never delete or renumber.

---

## What chat measured in Keva's exports (re-measure in Phase 1; never cite)

Files (NOT in the repo; never commit them):
- `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_sales_items_2026-10-31.xlsx`
- `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_inventory_2026_10_26.xls`

Sales-items workbook, sheet "Sales Items": blocks of rows, each block headed by
a menu-group title row, then a `Name | POS ID | Recipe | Sales Price | Cost |
Cost % | Category | Subcategory | Menu Group | Note` header row, then items.
Sheet "Items Needing Attention" = BevSpot's own flags.

Chat's counts:
- ~1,494 item rows across ~145 menu groups (includes modifier groups such as
  "Choose a Liquid", "ADD RED BULL", and an "Archived" group of 28 rows).
- 1,314 rows carry a 24-char Square-style ID (1,116 distinct); other "POS IDs"
  are names or short codes (items BevSpot never linked to Square).
- 867 distinct Square IDs have a recipe; **45 have two different recipes**
  (e.g. All That Razz (Kids): banana 0.8 oz in one row, 1 oz in the other; some
  pairs are an expanded recipe vs a one-line wrapper like
  `All That Razz (L) (1 serving)`).
- Recipe cell is one string: `Name (qty unit), Name (qty unit), …`.
  Traps: ingredient names contain commas
  (`Hershey Topping, Chocolate Liquid Bag Shelf Stable Syrup (1 fl. oz)`);
  units nest parentheses (`Coconut Water (1 bottle (1L))`,
  `Chia Seeds (0.181 container (96oz (dry)))`); double spaces in names
  (`Bananas  (0.8 oz (dry))`); 12 rows carry negative quantities (modifier
  removals like `-10 fl. oz`).
- Units seen: `fl. oz`, `oz (dry)`, `serving(s)`, `EA(s)`, `g`, `lbs`, `unit`,
  and package forms like `package (5lbs)`, `can (8.4fl. oz)`,
  `case (24 x 8.4fl. oz (can))`.
- ~276 distinct names referenced in recipes; ~166 of them are NOT products in
  the Las Brisas inventory export. Most are BevSpot prep/sub-recipes —
  `Cup Kit - 12/20/24/32oz`, `Cup Kit - Acai Bowl`, `Juice - Ginger 1 oz`,
  `Tahoe Lemonade - 1 oz`, `Juice - Carrot 1 oz`, `Kale - 1 oz portion` — and
  some are products another store carries (e.g. `Langers Pomegranate Juice`).
  A "Batch Recipe" menu group holds a few prep definitions, under different
  names than the references use.

---

## Phase 0 — repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, STOP and tell
Gary to re-run the `froot` alias.

```
git status
```
→ on `staging`, tree clean. Anything else: STOP.

```
git log --oneline -3
```
→ report it.

```
ls /Users/garythomas/Claude_Projects/bevspot-exports/
```
→ both exports present. If not, STOP and ask Gary to put them there.

---

## Phase 1 — audit (read-only), then STOP

Write findings to
`/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BEV-1_AUDIT.md`.
No code changes. Every database result carries the branch literal in the same
output (local `.env` is dev: `br-broad-wave`).

A. **Existing machinery**
   1. `src/lib/recipe-cost.ts` and `src/lib/units.ts` (or wherever units live):
      exact unit vocabulary, dimension groups, and which BevSpot units above
      convert today. List every BevSpot unit that does not.
   2. The recipe write path (`recipes` POST/PATCH routes, Zod schema, loop
      check). BEV-1 must reuse it or its validators — no second write path
      with weaker rules.
   3. `ingredients/import` (IV-3): what format it parses, whether it was built
      around BevSpot's export, and what parser/dependency it uses.
   4. Is any spreadsheet parser already a dependency (`xlsx`, `exceljs`,
      `papaparse`, other)? Can it read `.xlsx`? `.xls` (BIFF)?
   5. `SalesItem` sync: does it mirror Square **modifiers** or only item
      variations? (Expected: variations only. If so, modifier rows are out of
      scope for BEV-1 and nutrition for add-ons is a later phase.)
   6. Permission model for IV-2/IV-3 and where an ADMIN-only import page would
      sit in the Inventory nav.

B. **Parse the real export in memory** (throwaway script under
   `/tmp`, never committed; reads the file path above; writes nothing to the DB):
   1. Re-measure every count in "What chat measured". Report differences.
   2. Classify the 45 (or re-measured) conflicting Square IDs: how many are
      expanded-vs-self-named-wrapper pairs, how many are two genuinely
      different expanded recipes.
   3. Distinct referenced names, split into: matches a Froot `Ingredient` by
      exact name (dev, org-scoped) / matches by name after collapsing
      whitespace and case / matches an existing Froot sub-recipe
      (`Recipe` with `salesItemId` null) / no match. Show the no-match list.
   4. How many Square IDs in the export exist as `SalesItem.squareVariationId`
      on dev, and how many of those already have a `Recipe`.

C. **SQL for Gary to run in the Neon console** on staging and production
   (Claude never connects to them). Each query's first column is the branch
   literal (`'br-square-feather' AS branch` / `'br-sparkling-block' AS branch`),
   scoped to Keva's org: counts of active ingredients, recipes (with and
   without `salesItemId`), sales items by `recipeStatus`, and rows in
   `MenuItem` / `MenuItemNutrition` / `MenuItemAllergen` (expected zero —
   confirms the stub is unused).

D. **Forks — present each with chat's lean; Gary rules at the STOP:**

   - **F1 — Where nutrition lives.** Lean: computed from ingredients through
     recipes; the `MenuItem*` stub stays untouched now and gets a DEBT row to
     retire it once N-3 ships. (Alternative: hand-typed per-item numbers on
     the stub.)
   - **F2 — Master export.** Lean: the import runs against one store's export
     and writes org-level recipes for every store; Las Brisas #14 is Keva's
     master. Other stores' BevSpot recipes are never imported.
   - **F3 — Conflicting recipes for one Square ID.** Lean: if one row is a
     single-line wrapper that names the item itself, use the expanded row;
     otherwise import neither and list both for Gary.
   - **F4 — Sub-recipes not defined in the export** (Cup Kits, juice portions,
     etc.). Lean: link by exact name to an existing Froot sub-recipe; if none
     exists, skip the whole recipe and list "needs sub-recipe: X". Gary builds
     the handful of sub-recipes in Froot by hand or supplies BevSpot's
     prep-item export for BEV-2. BEV-1 never invents an empty sub-recipe —
     an empty Cup Kit would compute as zero cost and zero calories, silently.
   - **F5 — Unmatched ingredients.** Lean: exact name (after whitespace
     collapse, case-insensitive) or nothing. No fuzzy auto-match. A recipe
     with any unmatched line is skipped and listed with the missing names;
     the preview may show "did you mean" suggestions, never apply them.
     A partially imported recipe is worse than none — it under-reports
     calories and cost.
   - **F6 — Existing recipes.** Lean: never overwrite. Sales items that already
     have a `Recipe` are skipped and counted. Re-running the import after
     fixing ingredients picks up only what is still unmapped (idempotent).
   - **F7 — Modifier rows, negative quantities, Archived group, non-Square
     IDs.** Lean: all skipped and counted in the preview; none imported.
   - **F8 — Parser dependency.** Report what exists. If nothing reads `.xlsx`,
     lean: accept the sales-items `.xlsx` only (BEV-1 does not need the `.xls`
     inventory file under F5) with the smallest maintained dependency; adding
     any dependency is RULING NOW. Do not use the npm `xlsx@0.18.x` package
     (unpatched advisories).
   - **F9 — Schema.** Lean: none. Created recipe IDs go in one AuditLog row per
     apply (entityType "Import", action `bevspot.recipes.applied`) so an undo
     can be built later. If the plan genuinely needs a column, it is RULING
     NOW and the migration-STOP rule in CLAUDE.md applies.

**STOP.** Report: the audit file path, a one-screen summary, the forks with
leans, and the SQL block for Gary. Do not write code until Gary rules.

---

## Phase 2 — build (only after Gary's go, as ruled)

Defaults below assume the leans; follow Gary's rulings where they differ.

1. **Parser** — `src/lib/bevspot/parse-sales-items.ts`. Pure, no DB, no I/O
   beyond the bytes passed in. Walks group blocks, captures group name, row
   fields and Square ID, and parses the recipe string with a
   parenthesis-aware tokenizer: the quantity group is the **last balanced
   top-level parenthetical** of each line; line boundaries are resolved by
   preferring known names (Froot ingredient + sub-recipe names passed in) over
   naive comma splits, so `Hershey Topping, Chocolate Liquid Bag…` stays one
   name. Output is typed and lossless (keeps the raw string for display).
2. **Unit mapping** — `src/lib/bevspot/units.ts` maps BevSpot units onto
   Froot's vocabulary from Phase 1 A1, including package forms where the pack
   size is in the string (`package (5lbs)` → 80 oz (dry)). Unconvertible →
   line error, recipe skipped and listed. Never guess a density between
   `fl. oz` and `oz (dry)`.
3. **Planner** — `src/lib/bevspot/plan-import.ts`: given parsed rows + the
   org's ingredients, sub-recipes and sales items, returns a plan:
   `toCreate[]`, and `skipped[]` with a reason code per row
   (ALREADY_HAS_RECIPE, CONFLICT, MISSING_INGREDIENT, MISSING_SUBRECIPE,
   BAD_UNIT, NOT_IN_SQUARE, MODIFIER_OR_NEGATIVE, ARCHIVED, NO_RECIPE).
   Each new recipe is checked with the existing loop/dimension validators.
4. **Routes** (ADMIN only, `requireModule("inventory")`, org-scoped):
   - `POST /api/inventory/import/bevspot/preview` — upload → plan. Writes
     nothing. The file is parsed in memory and not stored.
   - `POST /api/inventory/import/bevspot/apply` — re-plans server-side from the
     same upload (never trusts a client-sent plan), then in one transaction
     creates `Recipe` + `RecipeLine` rows for `toCreate` and sets those sales
     items' `recipeStatus` to `MAPPED`. One AuditLog row with counts and
     created recipe IDs.
5. **Page** — ADMIN-only import page in the Inventory area (place per Phase 1
   A6): upload, preview summary ("312 ready · 41 need an ingredient · 18 need a
   sub-recipe · …"), expandable skip lists grouped by reason with the raw
   BevSpot line shown, then Apply. After apply, show the result and a
   "fix the listed items and import again" note. Copy is written for a store
   owner, not an engineer.
6. **Fixture** — `scripts/verify-bev1-import.ts`, pure (no DB): a small
   **synthetic** workbook built in code that reproduces every trap above
   (comma in name, nested-paren units, double space, negative qty, conflict
   pair with wrapper, conflict pair without, missing sub-recipe, missing
   ingredient, package unit, non-Square ID, archived group). Assert the plan's
   reason codes exactly. No real Keva data in the repo.
7. **Dry run on dev** — run the planner (not apply) against the real export
   and dev's org; paste the summary counts with `br-broad-wave` in the same
   output. Do not apply on dev unless Gary says so.

`npm run build` must pass before the work commit. Stage only files this
session touched (no `git add -A`).

---

## Phase 3 — docs commit (cites the work SHA)

- `docs/ROADMAP.yaml`: BEV-1 row `in_progress` with the work SHA (quoted
  short SHA); BEV-2, N-1, N-2, N-3, N-4 rows filed `planned` with the scopes
  above (or riders on existing N rows — preserve-and-mark); DEBT row for
  retiring the `MenuItem*` stub (if F1 ruled as leaned); a ROW for Square
  modifier nutrition (add-ons) if Phase 1 A5 confirms modifiers aren't synced.
  Read the file for the next free DEBT id — never assume (DEBT-84).
- `docs/DECISIONS.md`: draft entry with Gary's F1–F9 rulings in his words as
  given at the STOP. It is a draft until ratified in PRE-PUSH-CHECK.
- Commit this prompt and `BEV-1_AUDIT.md`.
- No DEPLOY_LOG entry here (PRE-PUSH-CHECK drafts it).

---

## Out-of-scope findings

Classify each FIX NOW / RULING NOW / COMMENT / ROW before the report. ROW is
the last resort. Nothing about nutrition values, labels, or public pages is
built in this session.

## Report and stop

Work SHA, docs SHA, files touched, prisma commands run (verbatim — `npm run
build` runs `prisma generate`; note it), fixture result, dev dry-run counts
with branch literal, and the skip lists Gary needs to act on (missing
ingredients, missing sub-recipes, conflicts). Then stop. Do not push. Do not
suggest the next phase.
