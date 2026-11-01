# N-1 — Phase 1 audit (read-only)

Session: N-1 (TIER 3), 2026-11-01. Prompt: `docs/prompts/N-1.md`.
Repo gate: `pwd` = `/Users/garythomas/Claude_Projects/Froot/froot`; branch
`staging`, up to date with `origin/staging`; HEAD `8e37495 docs(promotion):
stamp 62b9d86 — BEV-1b to shipped` (the STAMP-62b9d86 commit); only untracked
file `docs/prompts/N-1.md`.

Nothing in the tree was changed by this phase except this file. One
temporary script (`scripts/_n1-audit-probe.ts`) was written, run and
deleted: run 1–2 were SELECT-only against the local dev DB, run 3 was pure
(no DB). `git status --short` after deletion showed only the untracked prompt.
No prisma command was run.

---

## Headline

1. **Dev has no recipe data.** Measured on branch dev
   (`neon.branch_id` = `br-broad-wave-a6vpjdw0`, selected by the same query):
   org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (Keva Juice, Clerk
   `org_3FhYUR4l0ue7egug1I0Ig8wxOVn`, a production-originated row) holds
   **8 ingredients, 0 recipes, 0 categories**, and no other dev org holds any
   ingredient or recipe. The BevSpot import (225 ingredients / ~454 + 14
   recipes) exists on **production only**. Consequences: item F (categories)
   cannot be answered from dev, item G was measured on a synthetic graph, and
   the Phase 3 fixture must be pure / synthetic (as the prompt already
   prefers). Staging verification needs recipes on the staging branch; whether
   staging has them is unknown to this session (RULING NOW R-3).
2. **Units:** `tbsp`, `tsp`, `mL` are missing; `cup` and `g` exist. Adding
   them to `UNIT_INFO` automatically adds them to the ingredient
   **reporting-unit picker** and to every recipe/adjustment unit dropdown,
   because both read the same table (RULING NOW R-1).
3. **Cost engine** is cleanly reusable: `loadCostGraph` + `convert()`; the walk
   itself is inlined in `computeRecipeCost`, so the nutrition engine reuses the
   graph loader, `convert`, and the loop helpers, and mirrors (not shares) the
   ~60-line line walk — see B for why a shared generic walk is not worth it.
4. **Stub tables are dead code.** `MenuItem*` are referenced only by
   `prisma/schema.prisma` and the init migration. Untouched.
5. **There is no way to turn the nutrition module on** in the UI. The
   `nutrition` key already exists in `requireModule`, `GuideModule` and the
   /settings add-on card, but that card's "Upgrade" button is inert, and
   inventory was enabled the same way (no toggle route exists for
   inventory/nutrition). Keva would need `activeModules` updated — by SQL in
   the Neon console, or a new toggle route (RULING NOW R-2).
6. **Performance is a non-issue.** Cost-engine walk over a production-shaped
   synthetic graph (468 recipes, 5,078 lines): median **0.22 ms**, worst 4 ms
   (cold JIT). Graph load on dev was ~190–270 ms (two `findMany`s, network
   bound). Compute on request; no cache table.

---

## A. Units — `src/lib/units.ts`

Exact vocabulary (`UNIT_INFO`, 56 lines total):

| Unit | Dimension | toBase |
|---|---|---|
| `oz (dry)` | weight | 1 (base) |
| `lbs` | weight | 16 |
| `g` | weight | 0.035274 (BEV-1 F13) |
| `fl. oz` | volume | 1 (base) |
| `gal` | volume | 128 |
| `L` | volume | 33.814 |
| `qt` | volume | 32 |
| `pt` | volume | 16 |
| `cup` | volume | 8 |
| `each` | count | 1 |
| `serving` | count | 1 |

Rules in the file: count units never cross-convert (not even `each` ↔
`serving`); `convert()` returns `null` across dimensions and for unknown units
("never fall back to 0").

**Label units present:** `cup`, `g`. **Missing:** `tbsp`, `tsp`, `mL`.
(Also absent, for completeness: `kg`, `mg` — not asked for.)

**Can a basis be expressed in the ingredient's dimension with existing units?**
Yes for every dimension: weight via `g`/`oz (dry)`/`lbs`; volume via
`fl. oz`/`cup`/`L`; count via the ingredient's own reporting unit. Every label
basis in tbsp/tsp/mL is hand-convertible to `fl. oz` (1 tbsp = 0.5 fl. oz,
1 tsp = 1/6 fl. oz, 1 mL = 0.033814 fl. oz), so N-1 can ship with **zero**
unit additions if the CSV author (planning chat) converts those by hand. The
price of that: the source note says "per 2 tbsp" and the stored basis says
"per 1 fl. oz", which is a legibility cost, not a correctness one.

**Count-dimension constraint (design note, not a fork):** because count units
never convert, a recipe line on an `each` ingredient is always in `each`
(enforced by `compatibleUnits` in `src/lib/recipe-api.ts:71`). So for count
ingredients the nutrition basis unit **must equal the reporting unit
exactly** — `per 1 each` — and the write path must refuse anything else.
For weight/volume, the basis unit must be in the reporting unit's dimension
(`compatibleUnits(reportingUnit).includes(basisUnit)`).

**Blast radius of adding units** (`ALL_UNITS` / `compatibleUnits` consumers):

- `src/app/(app)/inventory/ingredients/ingredients-client.tsx:1146` —
  `ALL_UNITS` populates the ingredient **reporting unit** select. Adding
  `tbsp` here lets someone make an ingredient *counted in tablespoons*.
- `src/app/(app)/inventory/recipes/[id]/recipe-editor-client.tsx:212,215` —
  recipe line unit dropdowns.
- `src/app/(app)/inventory/adjustments/adjustments-client.tsx:363,517` —
  adjustment unit dropdowns.
- `src/lib/recipe-api.ts:65,71` and `src/lib/bevspot/plan-import.ts:312,324`
  — server validators (would newly *accept* the units; nothing previously
  valid becomes invalid).

Existing units' behaviour cannot change from an addition (each entry is
independent; `convert` is a ratio of two `toBase`s). The real effect is UI
surface — four dropdowns grow by three entries — and the reporting-unit one
is the one that matters. → **R-1**.

## B. Cost engine — `src/lib/recipe-cost.ts` (392 lines)

- **Graph:** `loadCostGraph(orgId)` — two queries (all org recipes with
  lines ordered by `sortOrder`; all non-deleted ingredients, selected
  fields). Builds `recipes`, `ingredients`, `preparedByRecipeId` maps. Note
  it loads **inactive and archived** ingredients too, and all recipes
  regardless of `isActive`.
- **Walk:** `computeRecipeCost` is recursive with a shared memo and an
  explicit stack. Per line:
  - sub-recipe line → recurse; `convert(line.amount, line.unit,
    sub.yieldUnit)`; contribution = `subCost / sub.yieldQty × amountInYieldUnits`.
  - ingredient line → `convert(line.amount, line.unit, ing.reportingUnit)` ×
    cost per reporting unit.
  - **PREPARED ingredient** line → costs **through its source recipe**
    (`srcCost / src.yieldQty` per reporting unit), not through the stored
    snapshot.
- **Yield:** `RecipeCost.cost` is the **whole-recipe total**;
  `costPerYieldUnit = total / yieldQty`. `costPct` compares the *total* to
  the sales item's price — i.e. a sales recipe is one sold item. Nutrition
  for a sales item is therefore the recipe total, the same way.
- **Missing data / failure:** loop (stack hit) or any line that can't convert
  → the whole recipe's `cost` is `null` with the first error message
  ("never a silent 0"). Line-level results are kept (`LineCost[]`).
- **Other walkers:** `expandRecipeToIngredients` (flatten to per-ingredient
  quantities; "theoretical" mode counts a PREPARED ingredient **and** its raws
  — correct for variance, **wrong for nutrition**, it would double-count);
  `findLoop`, `recipesUsing` (reverse reachability).

**Reuse plan for `src/lib/recipe-nutrition.ts`:**

- Reuse unchanged: `loadCostGraph` (extended, or a sibling loader that adds
  the nutrition record + allergens + `nutritionExempt` per ingredient — the
  `GraphIngredient` type is exported and other callers read it, so the
  sibling or an optional field is safer than widening the select for every
  cost caller), `convert`, `compatibleUnits`, `findLoop` /
  `loopErrorMessage`, the `Loop` type.
- Mirror, not share: the per-line recursion. The cost walk folds to one
  `number | null`; nutrition folds to a 15-nutrient vector with
  **per-nutrient** completeness plus an allergen set plus a blocking-ingredient
  list. A generic "fold over recipe graph" abstraction would have to be
  retrofitted under the cost engine — which the prompt rules out ("any change
  to cost math" is out of scope). The mirrored walk keeps the same semantics:
  same memo/stack loop handling, same `convert` calls, same sub-recipe
  `÷ yieldQty`, same prepared-through-source rule.
- Must NOT use `expandRecipeToIngredients(…, "theoretical")` (double-counts
  prep). `"consumption"` mode stops at the prepared ingredient, which would
  then need its own nutrition — also wrong. Hence the mirrored walk.
- Per-nutrient rule (F5): each nutrient accumulates as `number | "incomplete"`;
  a food line whose ingredient has no record, or has that nutrient null,
  turns that nutrient incomplete for the recipe and everything above it. A
  conversion failure or loop makes **every** nutrient incomplete (matches the
  cost engine's whole-recipe null).

## C. Stub tables

`grep` over `src/`, `scripts/`, `prisma/migrations/` (excluding generated
client): `MenuItem`, `MenuItemNutrition`, `MenuItemAllergen` appear only in
`prisma/schema.prisma` (models at lines 1916–1969, plus the
`Organization.menuItems` back-relation) and
`prisma/migrations/20260627002005_init/migration.sql`. Mentions in
`src/generated/roadmap.ts` are ROADMAP text. **No code path reads or writes
them.** They stay untouched; DEBT-124 retires them after N-3.

Note for N-2+: the stub's column names (`totalFatG`, `cholesterolMg`,
`vitaminDMcg`, …) are a reasonable naming precedent for the new table; reusing
the naming costs nothing and keeps DEBT-124's eventual diff legible.

## D. Modules and nav

- `requireModule("inventory" | "nutrition" | "hr" | "labor")` —
  `src/lib/auth.ts:21`; throws `MODULE_NOT_ACTIVE:<m>`; routes catch → 403
  (pattern: `src/app/api/inventory/ingredients/import/route.ts:30-34`). Pages
  check `org.activeModules.includes(...)` and redirect/render an upgrade state
  (e.g. `src/app/(app)/inventory/vendors/page.tsx:15`).
- `nutrition` is already a known key in: `requireModule`'s type,
  `GuideModule` (`src/lib/help-access.ts:24`), and the /settings add-on card
  (`src/app/(app)/settings/page.tsx:81`, "Menu item nutrition facts with
  embeddable public page").
- **How modules get enabled:** HR and Labor have ADMIN toggle routes
  (`api/hr/toggle`, `api/labor/toggle`) behind env availability gates.
  **Inventory and nutrition have no toggle** — the /settings card's
  "Upgrade" button (`settings/page.tsx:506`) has no handler. Inventory was
  enabled on Keva by direct DB write. Measured on dev (`br-broad-wave-a6vpjdw0`):
  org `cf888f2d-…` `activeModules = [inventory, labor, hr]` — no `nutrition`.
  Production and staging values not measured (no access by rule).
- **Env gate:** none needed. Because no org has `nutrition` and nothing in the
  UI can add it, `activeModules` alone keeps N-1 dark in production even if
  the code is promoted — which fits Gary's "nothing goes to production until
  confirmed on staging". (An `NUTRITION_MODULE_AVAILABLE` gate would only
  matter once a self-serve toggle exists.)
- **Nav:** `src/components/layout/sidebar.tsx` has `NavGroup` with
  `requiresModule` (line 81, applied at 327) — the INVENTORY section is the
  exemplar (lines 224–231, `storageKey: "froot-inventory-nav-open"`, children
  capability-gated). A NUTRITION group would sit directly after INVENTORY,
  `requiresModule: "nutrition"`, items "Menu Nutrition" and "Import
  Nutrition" (ADMIN capability). `activeModules` reaches the sidebar as a prop
  already.
- **Dependency:** recipes and ingredients live under the inventory module
  (every `/inventory/*` page and API is `requireModule("inventory")`). An org
  with `nutrition` but not `inventory` would have nutrition pages and no way
  to make recipes or reach the ingredient editor. → **R-4**.

## E. Permissions

- **IV-3 import gate** (`api/inventory/ingredients/import/route.ts`):
  `auth()` → org → `requireModule("inventory")` → `requireAdmin()` → body.
  The **preview is client-side** (`csv-import-button.tsx`: PapaParse +
  per-row `validateRow` + Status column); the server route only applies.
  BEV-1's import added a server **preview** route
  (`import/bevspot/preview` + `apply`, row IV-3 in the inventory) — the better
  model for N-1, because matching to existing ingredients needs the DB.
- **Ingredient edit gate:** `PATCH api/inventory/ingredients/[id]` and
  `bulk` → `requireManagerOrAdmin()` (MANAGER may edit ingredients today).
  So with F3's lean (ADMIN-only nutrition), nutrition **cannot ride the
  existing PATCH or bulk routes** without a role branch inside them. Cleaner:
  dedicated routes, e.g. `PUT/DELETE api/nutrition/ingredients/[id]` and
  `POST api/nutrition/ingredients/bulk-exempt`, each
  `requireModule("inventory")` + `requireModule("nutrition")` + ADMIN.
- **Capability registry:** `src/lib/permissions.ts` holds a typed
  `Capability` union (line ~115 for inventory) and role grants (line ~346;
  `inventory.import: ADMIN_ONLY`). New capabilities are a build-checked edit
  there plus §5 of `docs/PERMISSIONS_INVENTORY.md`. Proposed:
  `nutrition.view` (who sees the menu nutrition page) and `nutrition.manage`
  (ADMIN_ONLY: edit, flag, import). Naming follows `domain.resource.action`.
- **Inventory doc conventions for new routes:** a new `### 1x. Nutrition APIs`
  table in §1 (ID / Route(s) / What it guards / Roles allowed / Enforcement
  type), page guards in §1c, the nav entry in §1b, and capability rows in §5.
  IDs would be `NU-1…`.
- **Page lookup rule:** any new page uses `getCurrentUser()` — never a bare
  `clerkUserId` lookup (CLAUDE.md, DEBT-55).
- **Ingredient "edit view" is a dialog**, not a page:
  `IngredientDialog` inside `ingredients-client.tsx` (1,177 lines). Deliverable
  7 therefore lands as a section of that dialog (or a separate
  "Nutrition" dialog opened from the row) — the section is visible/editable
  only when `nutrition` is active and the user can `nutrition.manage`, and it
  saves through the new nutrition route, not the ingredient PATCH.

## F. Ingredient categories (not-food candidates)

**Cannot be produced from dev.** Measured on dev (`br-broad-wave-a6vpjdw0`):
org `cf888f2d-…` has **no** `IngredientCategory` rows; its 8 live
ingredients are all uncategorised: Raspberry Juice Blend (fl. oz), Rainbow
Sherbet (fl. oz), Bananas (sliced) (oz (dry)), Strawberries (sliced)
(oz (dry)), Cup - 32oz (each), Lid - 32oz (each), Spoon (long) (each),
Napkin (each). By name, the last four are not-food.

The real list lives on production. If Gary wants it before ruling, this
read-only query run in the **Neon console on the production branch** returns
it, with branch identity from the server (R4):

```sql
SELECT current_setting('neon.branch_id', true) AS branch_id,
       c.name AS category,
       i.subcategory,
       count(*) AS ingredients,
       string_agg(i.name, ' | ' ORDER BY i.name) AS names
FROM "Ingredient" i
LEFT JOIN "IngredientCategory" c ON c.id = i."categoryId"
WHERE i."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  AND i."deletedAt" IS NULL
GROUP BY c.name, i.subcategory
ORDER BY c.name NULLS FIRST, i.subcategory;
```

The not-food candidate list is not needed for any ruling — the bulk action
takes ingredient ids, not categories (F2 lean) — so this can wait for the
planning chat preparing the CSV.

## G. Performance

- Synthetic graph, production-shaped: 225 ingredients (mixed fl. oz /
  oz (dry) / each), 14 prep sub-recipes × 6 lines, 454 sales recipes × 10
  ingredient lines + 1 sub-recipe line = **468 recipes, 5,078 lines**.
  `computeAllRecipeCosts` over 20 runs: **median 0.22 ms, max 4.04 ms**.
  Pure, no DB.
- `loadCostGraph` on dev (tiny data): 190–270 ms — network/connection bound;
  production row counts add payload, not round-trips (still two queries).
- The nutrition walk does ~15× the arithmetic per line (vector of 15) plus a
  set union: still well under 10 ms. The menu page also needs sales items
  (one more query) and nutrition records (one join on the ingredient query).
- **Recommendation: compute on request, no cache table** (the lean stands).
  A cache would also introduce invalidation on every ingredient, recipe and
  nutrition edit — exactly the propagation the cost engine avoids by design
  (`recipe-cost.ts:5-7`).

---

## Forks — chat's lean, audit's view

- **N1-F1 Basis unit.** Lean: per amount in the ingredient's reporting
  dimension; add only the missing volume label units (tbsp, tsp, mL) as
  conversions; no density in N-1. *Audit:* agree on dimension + no density.
  Adding the units is safe for conversion math but **also surfaces them in
  the reporting-unit picker and three line-unit dropdowns** (A). Two clean
  options in R-1. Count ingredients: basis unit = reporting unit, enforced.
- **N1-F2 Not-food flag.** Lean: `Ingredient.nutritionExempt Boolean
  @default(false)`, per ingredient + bulk, not inferred. *Audit:* agree. The
  bulk action needs its own ADMIN route (existing `bulk` is MANAGER+ADMIN).
  PREPARED ingredients should never need the flag or a record (they compute
  through their source recipe).
- **N1-F3 Who edits.** Lean: ADMIN edits/imports; anyone with the module
  views. *Audit:* agree on ADMIN (`nutrition.manage: ADMIN_ONLY`). "Anyone"
  needs pinning: STAFF are excluded from inventory nav by STAFF-1 — lean
  `nutrition.view` = ADMIN, MANAGER, STORE (same as `inventory.nav.view`),
  not STAFF.
- **N1-F4 Storage.** Lean: `IngredientNutrition` 1:1 (nullable nutrients,
  `basisAmount` + `basisUnit`, `sourceNote`, `updatedByUserId`, `updatedAt`);
  allergens as a set on Ingredient. *Audit recommends* a Postgres **enum
  array**: `enum Allergen { MILK EGGS FISH CRUSTACEAN_SHELLFISH TREE_NUTS
  PEANUTS WHEAT SOYBEANS SESAME }` and `Ingredient.allergens Allergen[]
  @default([])`. Reasons: the set is fixed by statute and tiny; no per-allergen
  metadata in N-1; one column read with the ingredient (no join in the graph
  loader); the enum makes a typo impossible at the DB. "May contain" later is
  a second array (`mayContainAllergens`), additive. A join table only wins if
  allergens need per-row provenance. Note: the stub's `MenuItemAllergen` uses
  free `String` — do not copy that. Naming of nutrient columns: follow the
  stub (`totalFatG`, `sodiumMg`, …). Calories as `Float?` (not the stub's
  `Int?`) since per-basis values like 2.5 kcal/tsp scale.
- **N1-F5 Incomplete nutrients.** Lean: never sum past a missing value.
  *Audit:* agree; per-nutrient incomplete, and a conversion/loop error makes
  every nutrient incomplete (B).
- **N1-F6 Nav.** Lean: a Nutrition section (module-gated) holding the menu
  page and the import; per-ingredient editing stays on the ingredient page.
  *Audit:* agree; NavGroup after INVENTORY with `requiresModule:
  "nutrition"` (D). Ingredient editing = a section in the ingredient dialog.

## RULING NOW

- **R-1 Units (N1-F1 detail).** (a) Add `tbsp` (0.5), `tsp` (1/6), `mL`
  (0.033814) to `UNIT_INFO` **and** keep them out of the reporting-unit
  picker by exporting a `REPORTING_UNITS` list (the current 11) that
  `ingredients-client.tsx:1146` uses instead of `ALL_UNITS` — they then
  appear only in recipe/adjustment line dropdowns and the nutrition basis
  picker. Or (b) add nothing; the CSV converts tbsp/tsp/mL to fl. oz by hand
  and the source note keeps the label's wording. Audit lean: **(a)** — the
  label basis stays legible, recipes gain the units kitchens use, and the
  one picker where they would be harmful is fenced.
- **R-2 Turning the module on.** No toggle exists. Options: (a) Gary adds
  `nutrition` to Keva's `activeModules` via the Neon console on staging now
  and on production at promotion; (b) build an ADMIN toggle route + wire the
  /settings card (HR/Labor pattern) — scope creep for a one-org product.
  Audit lean: **(a)**, with the exact statement composed by planning chat
  (R2: apply instructions come from planning chat).
- **R-3 Staging data.** Staging verification needs the Keva recipes on the
  staging branch. Does staging have the BevSpot import? If not, the staging
  test plan needs either a BevSpot import run on staging first or a small
  hand-built recipe set (named `N-1 …` per the fixture-naming rule).
- **R-4 Module dependency.** Should the nutrition surfaces require
  `inventory` as well as `nutrition`? Audit lean: **yes, both** — without
  inventory there are no recipes and no ingredient editor.

## Out-of-scope findings (triage)

- **COMMENT** — /settings add-on card says "Menu item nutrition facts with
  embeddable public page" and its "Upgrade" button is inert. True of
  inventory too; N-3 makes the copy true. No action.
- **COMMENT** — `loadCostGraph` loads inactive/archived ingredients and
  inactive recipes; nutrition should match cost (a line on an archived
  ingredient still contributes). Recorded so N-1 does not diverge silently.
- **COMMENT** — dev holds no recipe data, so no DB-backed fixture can
  exercise real Keva shapes locally; the fixture is pure (prompt already
  prefers this).
- **FIX NOW** — none. **ROW** — none.

Counts: FIX NOW 0 · RULING NOW 4 (R-1…R-4) · COMMENT 3 · ROW 0.
