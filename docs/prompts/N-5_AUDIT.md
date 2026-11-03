# N-5 Phase 1 audit — Square modifiers: sync, modifier recipes, BevSpot modifier import

TIER 3. Read-only. Written 2026-11-03 by the N-5 session, before any code.
Prompt of record: `docs/prompts/N-5.md`. Companion artifact:
`docs/prompts/N-5_PROD_QUERY.sql` (read-only production SQL, § E).

**Repo gate (Phase 0):** `pwd` = `/Users/garythomas/Claude_Projects/Froot/froot`;
branch `staging`, up to date with `origin/staging`, clean apart from untracked
`docs/prompts/N-5.md`; HEAD `3945425` (the STAMP-4dbfa03 docs commit). Passed.

**What this session touched:** nothing in the app. It read source, read Square's
public docs, and parsed the BevSpot export in memory with the BEV-1 parser via a
scratchpad script (`npx tsx`, no DB connection). No database of any branch was
queried. No prisma command was run.

---

## Summary (one screen)

- **Scopes: nothing new is needed. No RULING NOW on scopes.** Modifier lists
  and modifiers come from `ListCatalog`, which needs `ITEMS_READ`; order line
  modifiers come from `SearchOrders`, which needs `ORDERS_READ`. Both are in
  the requested batch today (`src/app/api/square/auth/route.ts:15`) and both
  are exercised on production by code that works there now (item sync, sales
  sync). Froot stays read-only toward Square.
- **Sync is a clean addition.** Add `MODIFIER_LIST` to the `types` the
  existing sales-items sync already pages through; modifiers arrive nested
  inside each list; the item↔list links are on the ITEM objects already
  fetched. Item/variation behaviour does not have to change.
- **Sales usage is NOT small → recommend N-5b.** Today's usage reads
  `SalesLineCache` (date × variation), and `sales-sync.ts` throws modifiers
  away at aggregation. Counting them needs a new cache table, a change inside
  the BUG-7 race-guarded write, four readers, and a backfill/"complete since"
  answer for days cached before the change.
- **Negatives have one choke point.** `RecipeLineSchema.amount` is
  `.positive()` (`src/lib/recipe-api.ts:11`) and the BevSpot planner refuses
  `NEGATIVE_QTY` (`src/lib/bevspot/plan-import.ts:292`). Both the recipe API and
  the planner already run `validateRecipeLines`, so a "negative only on a
  modifier recipe" rule lives there once. The cost and nutrition engines are
  linear and **do not clamp** — a modifier netting negative stays negative.
- **Three hazards the scope didn't name** (proposed as forks N5-F6…F8):
  allergens are unioned even from negative lines ("No Banana" would claim
  banana's allergens); FDA label rounding floors small/negative values to 0 and
  must not be used for modifier display; and four places treat
  `salesItemId === null` as "prep recipe", so a modifier recipe would be listed
  as prep, offered as a sub-recipe, and could be made countable.
- **BevSpot (Las Brisas):** 1,496 rows, 1,118 distinct Square ids. Outside
  Archived/Unassigned with a Square id: 1,246 rows. Of those, **422 rows (364
  ids, 73 groups) sit in modifier-list-style groups; 274 have a recipe; 11 have
  a negative line (14 lines); ~100 reference another BevSpot row by name.**
  The "not one of your Square items" count can't be reproduced off production —
  **Query A** in `N-5_PROD_QUERY.sql` reproduces it today; **Query B** (which
  of those are modifiers) must wait until N-5 is on production and synced.
- **Schema:** three small read-only tables + one nullable unique FK on
  `Recipe`. Additive only.

---

## A. Square scopes and API

### A1. Scopes held

`src/app/api/square/auth/route.ts:15`:

```
MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ TIMECARDS_READ TIMECARDS_SETTINGS_READ
```

CLAUDE.md is right that this string is what Froot *asks for*, not what a token
*holds*. The evidence that production's grant includes the two N-5 needs is
behavioural, not a token read (the session does not touch production):
`/v2/catalog/list` (ITEMS_READ) is what "Sync from Square" calls, and BEV-1 was
run on production after that sync produced sales items; `/v2/orders/search`
(ORDERS_READ) feeds the forecasting and F-4 webhook caches on production.

**No scope is added by N-5 or by N-5b.** Nothing here is RULING NOW.

### A2. Square docs read (2026-11-03)

Read in the in-app browser (page text) unless marked otherwise. Square's
reference pages are for API version 2026-09-16; Froot pins `SQUARE_VERSION`
`2026-01-22` (`src/lib/square.ts:13`). Every field N-5 needs predates both.

1. **Permissions** — https://developer.squareup.com/docs/oauth-api/square-permissions
   (read by a fetch subagent, verbatim table): `ListCatalog`,
   `RetrieveCatalogObject`, `BatchRetrieveCatalogObjects`,
   `SearchCatalogObjects` → `ITEMS_READ`. `SearchOrders` → `ORDERS_READ`. The
   page does not define a scope's coverage in prose; that `ITEMS_READ` covers
   modifiers follows from `ListCatalog` returning them.
2. **ListCatalog** — https://developer.squareup.com/reference/square/catalog-api/list-catalog
   (subagent, verbatim): `types` is a comma-separated list; valid values
   include `MODIFIER_LIST` and `MODIFIER`. `MODIFIER` is not in the default
   set ("Object types that are nested onto other object types are not included
   in the defaults"). "ListCatalog does not return deleted catalog items. To
   retrieve deleted catalog items, use SearchCatalogObjects and set the
   include_deleted_objects attribute value to true."
3. **CatalogModifierList** — https://developer.squareup.com/reference/square/objects/CatalogModifierList
   (page text): `modifiers` is "A non-empty list of CatalogModifier objects …
   Each element of this list is a CatalogObject instance of the MODIFIER type"
   (`{ id, type: "MODIFIER", modifier_data }`). Other fields: `name`,
   `ordinal`, `selection_type` (deprecated → `min/max_selected_modifiers`),
   `modifier_type` (`LIST` | `TEXT`), `allow_quantities`, `internal_name`,
   `hidden_from_customer`, `image_ids` (several Beta).
4. **CatalogModifier** — https://developer.squareup.com/reference/square/objects/CatalogModifier
   (subagent, summary): `name`, `price_money`, `ordinal`, `modifier_list_id`,
   `on_by_default` (Beta), `location_overrides`, `hidden_online`,
   `kitchen_name`, `image_id`, `child_modifier_list_ids` (Beta, nested lists).
5. **CatalogItemModifierListInfo** (`item_data.modifier_list_info[]`) —
   https://developer.squareup.com/reference/square/objects/CatalogItemModifierListInfo
   (page text): `modifier_list_id` (required), `modifier_overrides`,
   `min_selected_modifiers`, `max_selected_modifiers`, `enabled` ("The default
   value is true"), `ordinal`, `allow_quantities`, `is_conversational`,
   `hidden_from_customer_override`. **No deprecation note.** It hangs off the
   ITEM, not the variation.
6. **OrderLineItemModifier** (`line_items[].modifiers[]`) —
   https://developer.squareup.com/reference/square/objects/OrderLineItemModifier
   (page text): `uid`, `catalog_object_id`, `catalog_version`, `name`,
   `quantity`, `base_price_money`, `total_price_money`, `metadata`,
   `parent_modifier_uid`. Two semantics that matter for N-5b:
   - `total_price_money` is "the modifier's base_price_money multiplied by the
     line item's quantity" → **modifier quantity is per unit of the line**;
     usage = line qty × modifier qty.
   - "The modifier quantity can be 0 or more … If the buyer does not want any
     cheese, the modifier quantity is set to 0." A **default-on modifier
     removed by the buyer arrives as quantity 0**, not as a separate "No X"
     modifier. Keva's catalog models removals as their own modifiers ("No
     Banana"), which the BevSpot rows confirm, but N-5b must decide what a
     quantity-0 default-on modifier means.

Not confirmed: the subagent could not render the `ListCatalog` page's example
response, so "modifiers come embedded in each MODIFIER_LIST from
`/v2/catalog/list`" rests on the object schema (item 3), not on an observed
payload. Phase 3's fixture uses a canned payload in that shape; the first
staging sync is the real proof, and the sync should also accept top-level
`MODIFIER` objects if they appear (cheap to handle both).

---

## B. Current sync — `src/app/api/square/sales-items/sync/route.ts`

How it works today (154 lines): ADMIN + `inventory` module + Square connected;
pages `/v2/catalog/list?types=ITEM,CATEGORY`; upserts `SquareCategory`, then one
`SalesItem` per variation, keyed `(organizationId, squareVariationId)`; then a
**sweep**: every category/variation NOT seen this run is set `isDeleted: true`;
stamps `Organization.lastCatalogSyncAt`; returns
`{ categories, salesItems }`.

Note on deletes: `obj.is_deleted` is read but, per A2 item 2, `ListCatalog`
never returns deleted objects — **the sweep is the real deletion mechanism**.
Modifiers should copy the sweep, not rely on `is_deleted`.

**How to add modifiers without changing item/variation behaviour:**

1. `types` → `ITEM,CATEGORY,MODIFIER_LIST`. The loop buckets by `obj.type`; a
   third bucket is additive. Category/item handling is untouched.
2. After the item loop (so nothing above it changes order), upsert each
   `MODIFIER_LIST` → `SquareModifierList`, each nested modifier →
   `SquareModifier` (name, `price_money.amount`, `ordinal`, `on_by_default`,
   list FK). Skip `modifier_type: "TEXT"` lists (free-text, no modifiers).
3. From the ITEM objects already in memory, write `item_data.modifier_list_info`
   → `SquareItemModifierList` (`squareItemId`, list FK, `enabled`). Replace the
   org's link set wholesale each sync (delete-then-insert in one transaction):
   links carry no Froot-side data, so there is nothing to preserve.
4. Sweep unseen lists/modifiers to `isDeleted: true`, exactly like SalesItem.
   A deleted modifier **keeps its recipe** (same as a deleted SalesItem keeps
   its recipe today); it just drops out of pickers and the Modifiers view
   (or shows "deleted in Square", matching SalesItem).
5. Response gains `modifierLists`, `modifiers`; the existing two keys keep
   their meaning, so `sales-items-client.tsx:127` keeps working.

**Risk worth naming — request duration.** Every upsert is sequential and
awaited. Keva production already runs ~700+ variation upserts in one POST;
modifiers add a few hundred more (§ E: ≥364 distinct ids in modifier-style
groups at one store). The route sets no `maxDuration`. Phase 3 should batch the
modifier writes (one transaction, `createMany` for new rows + `updateMany` per
changed row, or chunked upserts) rather than add hundreds more sequential
round-trips. Not a blocker; flagged so it isn't discovered on production.

Also: the sweep's `notIn: undefined` when nothing was seen marks every row
deleted. That is existing SalesItem behaviour; modifiers inherit it. An org
with zero modifier lists would sweep nothing harmful (it has none).

---

## C. Sales data — where usage comes from, and what modifiers would need

**Path today.** "Usage / wk estimated from synced sales"
(`src/app/(app)/inventory/ingredients/ingredients-client.tsx:435,488`) comes
from `computeWeeklyUsage` → `salesUsageForWindow` in
`src/lib/expected-inventory.ts:86-131`, which reads `SalesLineCache` rows
(store × date × `squareVariationId` → `quantitySold`), maps each variation to its
`SalesItem.recipe`, and expands in consumption mode with
`expandRecipeToIngredients` (`src/lib/recipe-cost.ts:320`).

**Are order modifiers stored? No.** `src/lib/sales-sync.ts:369-376` aggregates
`line.catalog_object_id` × `line.quantity` and discards everything else on the
line, `modifiers[]` included. Raw orders are never stored. Both the manual sync
and the F-4 webhook (`src/app/api/webhooks/square/route.ts:121`) go through
`syncSalesForStore`, so one change there covers both feeds.

**What modifier usage would need:**

1. Parse `line_items[].modifiers[]`; aggregate `line qty × modifier qty` per
   (date, `catalog_object_id`) (A2 item 6 semantics).
2. A new cache table (`SalesModifierCache`, store × date × squareModifierId).
3. Write it inside `writeSalesCache` (`sales-sync.ts:144-251`) — the BUG-7
   race-guarded transaction whose statement order is documented as
   load-bearing. The new delete+insert must sit after the guarded period upsert,
   filtered to won dates, exactly like the line rows.
4. Readers: `expected-inventory.ts` (expected on-hand, weekly usage → pars,
   low-stock alerts, order guide), and decide for
   `api/inventory/reports/{variance,profitability,item-sales}`.
5. **History:** every day cached before the change has no modifier rows. A
   window spanning the change would silently undercount — the exact thing
   expected-inventory's header promises never to do. Needs a re-sync of the
   window or an org-level "modifier sales complete since" date the engine
   checks.
6. The quantity-0 default-on question (A2 item 6).
7. Its own migration.

**Recommendation: N-5b.** It touches the race-safe write path, five consumers,
and needs a history answer — each its own review surface, none of which the
modifier sync or recipes depend on. N-5 lands the modifiers and their recipes;
N-5b makes sales consume them. (Chat's lean N5-F1 agrees.)

---

## D. Recipes — negatives, cost, nutrition

### D1. Where negatives are refused today

| Where | What |
|---|---|
| `src/lib/recipe-api.ts:11` | `RecipeLineSchema.amount: z.number().positive()` — used by POST `api/inventory/recipes/route.ts:79` and (via `.partial()`) PATCH `recipes/[id]/route.ts:16` |
| `src/lib/bevspot/plan-import.ts:292` | `if (line.qty < 0) return fail("NEGATIVE_QTY", …)` (F7) |
| `src/lib/bevspot/plan-import.ts:296` | `mapped.amount <= 0` → `BAD_UNIT` ("Zero amount") — zero stays refused |
| `src/lib/nutrition.ts:111,117` | ingredient nutrition basis/values must be ≥ 0 — **unrelated, stays** |

### D2. Smallest safe way to allow them for modifier recipes only

1. `RecipeLineSchema.amount` → `z.number().refine(n => n !== 0 && Number.isFinite(n))`.
2. **The rule lives in `validateRecipeLines`** (`recipe-api.ts`), which the
   POST route, the PATCH route (on the merged recipe, `[id]/route.ts:130`) and
   the BevSpot planner already all call: a line with `amount < 0` is a line
   error unless the candidate recipe is attached to a modifier.
3. Same function: a line whose `subRecipeId` points at a **modifier recipe** is
   refused. This is what keeps negatives contained — a modifier recipe can
   never be folded into an item or prep recipe, so a negative can never leak
   into a menu item's cost or label.
4. The modifier link is not a field the PATCH body can toggle to dodge (2):
   `RecipeSchema` gets `squareModifierId`, and the routes refuse a recipe with
   both `salesItemId` and `squareModifierId` set.

### D3. Cost engine — `src/lib/recipe-cost.ts`

`computeRecipeCost` (164-262) sums `qty × costPerReportingUnit` per line with no
`Math.max`/`abs`; `convert()` (`src/lib/units.ts:46-54`) is a pure
multiplication, sign-preserving. **A negative line costs negative; a recipe
netting negative stays negative. No clamp.** `expandRecipeToIngredients`
(320-361) is equally linear, so N-5b's usage will subtract correctly.
`costPct` (270) returns null for a $0 price and a signed % otherwise — fine for
display. `recomputePreparedIngredientCosts` only touches prepared ingredients,
which modifier recipes must never be (D5).

### D4. Nutrition engine — `src/lib/recipe-nutrition.ts`

`computeRecipeNutrition` (133-281) scales values linearly (`scaled`, 124-131)
and sums with no clamp. **Totals keep their sign.** Two problems:

- **Allergens from negative lines (N5-F6).** Lines 208 and 224 (and 167, via
  a sub-recipe's `absorb`) union allergens regardless of line sign. "No Banana" (−1.6 oz) or
  "Sub oat ice-cream" (−10 fl oz Vanilla Yogurt, +10 fl oz oat) would *add*
  the removed ingredient's allergens (milk, in the second case) to the
  modifier. A removal can't add an allergen; nor can it take one off the base
  drink. Proposed: negative lines contribute no allergens; the Modifiers view
  shows a modifier's allergens as "may add: …" from positive lines only.
- **Label rounding clamps (N5-F7).** `src/lib/nutrition-label.ts`
  (`roundFat`/`roundGram` 132-152: `< 0.5 → 0`, plus `roundStep`) is FDA
  declaration rounding for a positive label and maps small or negative values
  to 0. The Modifiers view must show **signed, plainly rounded deltas**
  ("−120 kcal", "+4 g sugar"), never pass a modifier through the label
  rounding functions. N-5 builds no label for a modifier.

`complete` / `partial` / `missing` work unchanged: a modifier whose removed
ingredient has no nutrition is partial, which is correct.

### D5. The `salesItemId === null` means "prep" assumption (N5-F8)

A modifier recipe has `salesItemId = null`. Four places read that as "prep":

| File | Effect if unchanged |
|---|---|
| `src/app/(app)/inventory/recipes/page.tsx:80` | modifier recipes listed under Prep Recipes |
| `src/app/(app)/inventory/recipes/[id]/page.tsx:75-80` | offered as sub-recipe lines (`isPrep: true`) — the leak D2.3 closes |
| `src/app/api/inventory/recipes/[id]/route.ts:173` | `countable: true` accepted → a modifier becomes a prepared ingredient |
| `src/app/(app)/inventory/adjustments/page.tsx:79` | safe — also requires `preparedIngredient` |

And `src/lib/bevspot/plan-import.ts:273` builds sub-recipes with
`salesItemId: null`. Phase 3 should introduce one helper
(`recipeKind(r) → "item" | "modifier" | "prep"`) and use it at each site,
per CLAUDE.md § Verifying a guard covers every path — the sites above were
found by searching the field's shape, so Phase 3 re-enumerates every
`graph.recipes` / `prisma.recipe.findMany` consumer before claiming coverage.

---

## E. BevSpot — Las Brisas export, re-parsed in memory

File: `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_sales_items_2026-10-31.xlsx`
(907,067 bytes, 2026-10-31 16:37 local). Parsed with
`parseSalesItemsWorkbook` (the BEV-1 parser, unchanged) in a scratchpad
script; nothing written anywhere but the scratchpad and
`N-5_PROD_QUERY.sql`.

### E1. Whole file

| | count |
|---|---|
| rows | 1,496 |
| groups (block titles) | 145 |
| rows with a 24-char Square id | 1,316 (1,118 distinct ids) |
| rows without a Square id | 180 |
| rows with a recipe / parse errors | 1,121 / 0 |
| rows with a negative line | 12 (15 lines) |
| Archived + Unassigned rows | 28 + 201 |

### E2. "Not one of your Square items" — what can and can't be said off production

BEV-1 classifies NOT_IN_SQUARE as *Square id is not a live Froot SalesItem*
(`plan-import.ts:214`, loaded at `import-server.ts:75`). That depends on
production's `SalesItem` rows, which this session does not read, and dev's
catalog does not carry Keva's production ids. **So the ~491 figure in the
prompt is not reproduced here.** Query A below reproduces it on production
today.

What the file alone says, restricted to rows BEV-1 would consider (outside
Archived/Unassigned, with a Square id: **1,246 rows, 1,063 ids**), split by
whether the block title looks like a Square modifier list (heuristic: "SELECT
…", "ADD …", "… TOPPERS", "Modif…", "… OPTION", "Choose …", "Drizzle", all-caps
titles, etc.):

| | modifier-list-style groups | menu-style groups |
|---|---|---|
| groups | 73 | — |
| rows | **422** | 824 |
| distinct Square ids | **364** | 703 |
| rows with a recipe | **274** | 651 |
| rows with a negative line | **11** (14 lines) | 0 |
| rows whose lines name another BevSpot row* | ~100 | ~528 |
| modifier-style row names ("Add/Sub/No/Extra…") | 95 | 8 |

\* Upper bound for "references a prep recipe": a line name equal to another
row's name. Some of those names are also ingredient names; F11 (ingredient
wins) resolves them at plan time. The precise prep count comes out of the
planner preview, not this heuristic.

The heuristic is imperfect both ways (e.g. "Gourmet Drizzled Strawberries" and
"KEVACCINO" are probably menu groups; BEV-1 A5 found many add-on rows are real
variations). It is a size estimate. **The real classifier is Query B: is the id
a synced `SquareModifier`.** BEV-1's rule stays — never judge by group name.

### E3. Every negative row in the file

| row | group | name | recipe |
|---|---|---|---|
| 922 | Keva Bowl Modifications and Requests | No Banana Blended | Bananas (−1.6 oz (dry)) |
| 1002 | Million Dollar Smoothie Modifier | No Hemp Seeds | Hemp Seeds (−1 oz (dry)) |
| 1018 | MODIFY SMOOTHIE | No Banana (add 2oz juice) | Bananas (−1.6 oz (dry)) |
| 1026 | MODIFY THIS TEMPTER | No Banana (add 2oz juice) | Bananas (−1.06 oz (dry)) |
| 1027 | MODIFY THIS TEMPTER | No Chocolate | Hershey … Chocolate … Syrup (−1 fl. oz) |
| 1485 | SELECT RED BULL | No Red Bull | Red Bull Regular (−1 can (8.4fl. oz)) |
| 1511 | SELECT WATERMELON RED BULL | No Red Bull | Red Bull Watermelon (−1 can (8.4fl. oz)) |
| 1533 | SMOOTHIES NON-DAIRY OPTION | Non-Dairy Sub Oatmilk Ice-cream | Vanilla Yogurt (−10 fl. oz), Oatmilk Vanilla (+10 fl. oz) |
| 1650 | TEMPTER NON-DAIRY OPTION | … Oatmilk Ice-cream and Almond Milk | Almond Milk (+6), Vanilla Yogurt (−10), Nonfat Milk (−6), Oatmilk Vanilla (+…) |
| 1672 | TEMPTERS NON-DAIRY OPTION | … and Coconut Milk | Vanilla Yogurt (−10), Nonfat Milk (−6), Coconut Milk (+6), Oatmilk Vanilla (+…) |
| 1673 | TEMPTERS NON-DAIRY OPTION | … and Oatmilk | Vanilla Yogurt (−10), Oat Milk (+6), Nonfat Milk (−6), Oatmilk Vanilla (+…) |
| 1824 | Unassigned | No Banana | Bananas (−2 oz (dry)) |

Every negative sits in a modifier-style group except row 1824, which is
Unassigned and is dropped by F3 anyway. So "negatives only for rows that
resolve to a modifier" (N5-F4) loses nothing visible in this file.

Two observations for Phase 3:

- "No Red Bull" (−1 can) and "No Chocolate" net **negative cost** — the
  "stays negative" path is exercised by real data, not only the fixture.
- "−1 can (8.4 fl. oz)" must map through `mapBevSpotQty`
  (`src/lib/bevspot/units.ts:70`) with its sign intact; Phase 3 checks the
  mapper doesn't assume positive input (F12's whole-package SUSPECT_QTY rule
  in particular — a −1 can is a removal, not a suspicious whole package).

### E4. Production query

`docs/prompts/N-5_PROD_QUERY.sql` — every distinct Square id in the file
(1,118), inlined as a `VALUES` list. SELECT only; the branch comes from
`current_setting('neon.branch_id', true)`; the org is
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (Keva Juice, production), selected by id
and echoed with its name, so a wrong branch returns zero rows or a wrong name
rather than a plausible count.

- **Query A — runnable today.** Of the 1,118 ids: live sales items, deleted
  sales items, not a sales item. "Not a sales item" is the population N-5
  targets (BEV-1's NOT_IN_SQUARE, before group/archive filtering).
- **Query B — must wait** until N-5 is promoted to production and an ADMIN has
  run "Sync from Square" there: before that, the modifier table does not exist.
  It splits "not a sales item" into live modifier / deleted modifier / neither.
  Written against the proposed schema (§ F); Phase 3's report re-issues it if
  names change.

---

## F. Schema — smallest shape

All additive. Proposed for Phase 2 (names open to Gary):

```prisma
model SquareModifierList {
  id                   String  @id @default(cuid())
  organizationId       String
  squareModifierListId String
  name                 String
  ordinal              Int?
  isDeleted            Boolean @default(false)
  updatedAt            DateTime @updatedAt

  organization Organization             @relation(fields: [organizationId], references: [id])
  modifiers    SquareModifier[]
  itemLinks    SquareItemModifierList[]

  @@unique([organizationId, squareModifierListId])
}

model SquareModifier {
  id               String  @id @default(cuid())
  organizationId   String
  squareModifierId String
  modifierListId   String
  name             String
  priceCents       Int?     // base price; location overrides ignored (read-only display)
  ordinal          Int?
  onByDefault      Boolean @default(false)
  isDeleted        Boolean @default(false)
  recipeStatus     String  @default("UNMAPPED") // UNMAPPED | MAPPED | NON_RECIPE — same vocabulary as SalesItem
  updatedAt        DateTime @updatedAt

  organization Organization       @relation(fields: [organizationId], references: [id])
  modifierList SquareModifierList @relation(fields: [modifierListId], references: [id])
  recipe       Recipe?

  @@unique([organizationId, squareModifierId])
  @@index([modifierListId])
}

// Item ↔ list. Keyed by the Square ITEM id (string): SalesItem is one row per
// variation, and modifier_list_info lives on the item.
model SquareItemModifierList {
  id             String  @id @default(cuid())
  organizationId String
  squareItemId   String
  modifierListId String
  enabled        Boolean @default(true)

  organization Organization       @relation(fields: [organizationId], references: [id])
  modifierList SquareModifierList @relation(fields: [modifierListId], references: [id], onDelete: Cascade)

  @@unique([organizationId, squareItemId, modifierListId])
  @@index([organizationId, squareItemId])
}

model Recipe {
  // + one field, mirroring salesItemId:
  squareModifierId String?         @unique
  squareModifier   SquareModifier? @relation(fields: [squareModifierId], references: [id])
}
```

Notes:

- `Recipe` gets a nullable unique FK, the same shape as `salesItemId`. "At most
  one of `salesItemId` / `squareModifierId`" is enforced in Zod and the routes.
  A DB `CHECK` is possible but would be hand-added to the generated migration
  SQL; offered, not proposed.
- `SquareModifier.recipeStatus` lets "no recipe needed" ("Light Ice",
  "Location Type") be marked so it doesn't nag, mirroring SalesItem.
- No sales tables here — N-5b adds `SalesModifierCache` with its own
  migration.
- Not modelled (out of scope): nested `child_modifier_list_ids`, location
  price overrides, `modifier_overrides`, size-scaled modifiers.

---

## Forks — chat's leans; Gary rules

| Fork | Lean (chat / this audit) |
|---|---|
| **N5-F1 Scope** | Sync + modifier recipes + BevSpot modifier import + internal Modifiers view in N-5; **sales usage → N-5b**. The audit agrees: § C is not small. |
| **N5-F2 Negative lines** | Allowed only on modifier recipes; a modifier's cost/nutrition may net negative and is shown with its sign. Enforced once in `validateRecipeLines`. |
| **N5-F3 One recipe per modifier** | One recipe, all sizes, for now. |
| **N5-F4 BevSpot modifiers** | Same BEV-1 rules (exact match, never overwrite, preview first); negatives only for rows that resolve to a synced modifier. (E3: loses nothing in this file.) |
| **N5-F5 Public menu** | No add-ons on the public menu in N-5. |
| **N5-F6 Allergens on negative lines** *(new)* | A negative line contributes no allergens; Modifiers view shows "may add" allergens from positive lines only. |
| **N5-F7 Modifier nutrition display** *(new)* | Signed, plainly rounded deltas; never FDA label rounding; no label for a modifier in N-5. |
| **N5-F8 Modifier recipes are their own kind** *(new)* | Never a sub-recipe line, never countable/prepared, not listed as prep; a shared `recipeKind()` at every site in D5, re-enumerated in Phase 3. |

## RULING NOW

**None on scopes** — no new OAuth scope is needed (A1). The forks above are
the rulings this STOP needs; N5-F1 decides whether N-5b gets filed.

## Production query

`docs/prompts/N-5_PROD_QUERY.sql`: Query A runnable today; Query B waits for
N-5 on production + a sync (§ E4).

## Not done / unverified

- Whether `/v2/catalog/list` returns modifiers embedded in each list was
  established from the object schema, not an observed payload (A2).
- The ~491 count is not reproduced (needs production; Query A).
- The modifier-group split in E2 is a name heuristic, not a classification.
