# BEV-1 — Phase 1 audit (read-only)

Session: BEV-1, TIER 3. Written 2026-10-31 at the Phase 1 STOP, before any
code. Prompt of record: `docs/prompts/BEV-1.md`.

**Provenance of every measurement below:**
- **Export:** `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_sales_items_2026-10-31.xlsx`
  (907,067 bytes, mtime 2026-10-31 16:37 local). Gary moved the source from
  `bevspot-exports/` to Downloads in chat. The file was not moved or copied,
  and it is not in the repo.
- **Inventory `.xls`:** `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_inventory_2026_10_26.xls`
  (158,208 bytes). It is **not read** (see B1, "not re-measured").
- **Reader:** a throwaway Python script using only the stdlib
  (`zipfile` + `xml.etree`) in the session scratchpad
  (`/private/tmp/claude-501/.../scratchpad/bev1/`). It is not committed, and
  the `xlsx` npm package was **not** used to read the file.
- **Dev reads:** a throwaway, read-only `npx tsx` script in the same
  scratchpad, importing `src/lib/prisma.ts` with the local `.env`. Its only
  statements are `findMany` / `count` / `SELECT current_setting(...)`. No
  writes. Every dev result below carries the branch id that the **query
  itself returned**: `br-broad-wave-a6vpjdw0` (dev).
- **Dev org:** `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` ("Keva Juice", clerkOrgId
  `org_3FhYUR4l0ue7egug1I0Ig8wxOVn`). It is the only org on dev with any
  sales items, ingredients or recipes. **Caveat, per CLAUDE.md § Browser
  Evidence:** that clerkOrgId is a *production* Clerk org; the row reached
  dev when the branch was forked. The id identifies the dev **database row**
  used here. It does not establish which Clerk instance owns it.

---

## Headline — three things that change the plan

1. **The export DEFINES most of what the prompt calls "sub-recipes not in the
   export".** `Cup Kit - 12/20/24/32oz` and `Cup Kit - Acai Bowl` are rows in a
   **"Recipe Kits"** menu group with full recipes (cup + lid + straw). The
   `Juice - Ginger / Celery / Cucumber 1 oz` portions are rows in **"Juice
   Fresh"**. `Kale - 1 oz portion` is in "Batch Recipe", and `Tahoe Lemonade -
   1 oz` is in "Recipe Kits". Of the five examples chat named, only
   `Langers Pomegranate Juice` is undefined, and it is a product, not a prep.
   **F4's premise does not hold.** F4 as leaned would skip every recipe that
   uses a Cup Kit, which is nearly every smoothie, *even though the export
   holds the Cup Kit definition.* New fork **F10**.
2. **227 recipe rows are single-line "wrappers" that point at ANOTHER sales
   item by name**, for example `Bulls Eye (24oz)` → `Bulls Eye (M) (1 serving)`
   and `Green Giant Juice Blend (12oz)` → `Green Giant (12oz.) (1 serving)`.
   In total, 97 referenced names resolve only to Square-linked sales rows,
   which means BevSpot uses one sales item's recipe as a sub-recipe of
   another. Froot's validator permits a sub-recipe line that targets a recipe
   with a `salesItemId`, so this is expressible. **No fork covers it** (F10).
3. **Names collide between products and sales items.** 17 sales items have a
   one-line recipe naming a product with *the same name* as the item
   (`Chia Seeds` → `Chia Seeds (1 oz (dry))`, `Coconut Water` →
   `Coconut Water (5 fl. oz)`, `Honey`, `Almond Milk`, …). A line reading
   `Chia Seeds (…)` can therefore mean the ingredient or the sales item.
   Resolving by name alone needs a precedence rule; resolving it the wrong
   way creates a self-loop. New fork **F11**.

Also material: **dev cannot answer B3 in any useful way.** Dev's Keva org has
**8 ingredients** (the razz fixture — `Raspberry Juice Blend`, `Rainbow
Sherbet`, `Bananas (sliced)`, …) and **0 recipes**, so 0 of 276 names match.
The real match rate depends on staging/production ingredient names, so § C
adds a name-list query.

---

## A. Existing machinery

### A1. Unit vocabulary — `src/lib/units.ts`

Ten units in three dimensions. `toBase` is the count of the dimension's base
unit (`oz (dry)` for weight, `fl. oz` for volume):

| Dimension | Units |
|---|---|
| weight | `oz (dry)` (1), `lbs` (16) |
| volume | `fl. oz` (1), `gal` (128), `L` (33.814), `qt` (32), `pt` (16), `cup` (8) |
| count | `each`, `serving` — **never cross-convert**, not even to each other |

`convert()` returns `null` across dimensions and between two different count
units. `recipe-cost.ts` and `recipe-api.ts` treat `null` as a line error (N/A,
never 0). Recipe lines are validated with `compatibleUnits(reportingUnit or
yieldUnit).includes(line.unit)` (`src/lib/recipe-api.ts:65,70`).

There is no density anywhere: `fl. oz` ↔ `oz (dry)` is impossible by
construction. `ingredients/[id]/weights` holds tare/full container weights
for weighing counts, not a density.

**The 38 BevSpot units seen (line counts), mapped onto Froot:**

| BevSpot unit | Lines | Converts today? |
|---|---|---|
| `fl. oz` | 1415 | ✅ identical string |
| `oz (dry)` | 1092 | ✅ identical string |
| `serving` / `servings` | 696 / 190 | ✅ after a plural → `serving` map |
| `EA` / `EAs` | 107 / 8 | ✅ after a map → `each` |
| `lbs` | 3 | ✅ identical string |
| `g` | **65** | ❌ **not in the vocabulary.** It is a pure mass→mass conversion (1 g = 0.035274 oz (dry)) and needs no density, but it requires adding `g` to `UNIT_INFO`. That is a code change, not a schema change. |
| `unit` | **11** | ❌ count of unknown meaning (`Straws (1 unit)` — every Cup Kit carries one) |
| `other (1 unit)` | **1** | ❌ same (`Whirley 24oz Keva Mug`) |
| `package (5lbs)`, `package (1lbs)`, `package (18oz (dry))`, `package (3.5oz (dry))`, `package (6oz (dry))`, `bag(s) (32oz (dry))`, `bag (5lbs)`, `bag (10lbs)`, `tub (7lbs)`, `tub (2lbs)`, `tub (32oz (dry))`, `container (96oz (dry))`, `case(s) (5 x 2lbs (package))`, `case (20 x 4oz (dry) (package))` | 29+2+3+1+1+9+9+1+1+6+2+3+4+2+1 | ✅ **derivable**: the pack size is in the string, and it lands in weight |
| `can (8.4fl. oz)`, `can (8fl. oz)`, `can (12fl. oz)`, `bottle (16.9fl. oz)`, `bottle (1L)`, `tub (3gal)`, `case (24 x 8.4fl. oz (can))`, `case (1 x 20fl. oz (package))`, `case (1 x 1gal (carton))` | 24+1+1+6+1+2+3+1+1 | ✅ **derivable**, lands in volume |
| `package (1 ea)`, `package (4 ea)`, `case (4 x 6 ea (package))` | 1+2+1 | ✅ **derivable**, lands in `each` |

Unconvertible today: **`g` (65 lines), `unit` (11), `other (1 unit)` (1).**
Beyond that, every line also has to agree in dimension with the matched
ingredient's `reportingUnit`. That cannot be measured until real ingredient
names are matched (§ C, query 3).

**Data-quality flag (not a unit problem):** 38 recipe rows use **one or more
whole packages**. Examples: `Honey (1 package (5lbs))` ×3 (an 80 oz-per-drink
reading), `Tea Zone … Popping Boba Pearls (1 tub (7lbs))` ×4, `Red Bull … (1
case (24 x 8.4fl. oz (can)))` ×3, `Hemp Seeds (1 bag (32oz (dry)))` ×5,
`Coconut Flakes (2 cases (5 x 2lbs (package)))`. They convert cleanly and are
almost certainly BevSpot entry errors. Imported faithfully, they would
compute as absurd cost and, later, absurd calories. New fork **F12**.

### A2. The recipe write path — the one BEV-1 must reuse

- **Validation:** `src/lib/recipe-api.ts` — `RecipeSchema` / `RecipeLineSchema`
  (Zod: `amount` **positive**, so negative quantities are rejected at the
  schema; exactly one of `ingredientId` / `subRecipeId`),
  `candidateFromInput()`, and `validateRecipeLines(graph, candidate)`
  (per-line dimension check, then a loop check with the candidate grafted
  into the graph).
- **Create:** `POST /api/inventory/recipes` (`src/app/api/inventory/recipes/route.ts`).
  Order: auth → org → `requireModule("inventory")` →
  **`requireManagerOrAdmin()`** → Zod parse → reject a sales item that
  already has a recipe (409) → `loadCostGraph` + `validateRecipeLines` → in
  one `$transaction`, `recipe.create` (nested lines) and
  `salesItem.update({ recipeStatus: "MAPPED" })`.
- **PATCH** (`recipes/[id]/route.ts`) uses the same schema (`.partial()`) plus
  `countable`, and calls `recomputePreparedIngredientCosts`.
- **No AuditLog is written on recipe create or update today.**
- **Batch implication:** `validateRecipeLines` checks ONE candidate against
  the graph. BEV-1 creates many recipes that reference each other (Cup Kit →
  smoothie, `Bulls Eye (M)` → `Bulls Eye (24oz)`), so its plan must graft
  every new recipe into the graph **before** loop-checking, and create them
  in dependency order inside the transaction (sub-recipes first, so real ids
  exist). Reusing the validators is possible; reusing the POST *route* as-is
  is not.
- **Schema facts:** `Recipe.salesItemId` is `@unique`, so a sales item has at
  most one recipe. `Recipe.name` has **no** uniqueness constraint, so a
  name-keyed "existing sub-recipe" match can hit two rows (BEV-1 must treat
  that as ambiguous, not pick one).

### A3. `ingredients/import` (IV-3)

`src/app/api/inventory/ingredients/import/route.ts`. It takes **JSON rows**
(an array), not a file. The client (`(app)/inventory/ingredients/csv-import-button.tsx`)
parses a **CSV with PapaParse in the browser**. Columns are Froot's own field
names (`name`, `purchaseUnitLabel`, `reportingUnit`, `unitsPerPurchase`, …),
not BevSpot's. **It was not built around BevSpot's export**: nothing in it
references BevSpot, `.xls` or `.xlsx`. It is `requireAdmin()`, creates rows
one at a time (no transaction), never de-duplicates by name, and writes no
AuditLog.

### A4. Spreadsheet parsers already in `package.json`

- `papaparse ^5.5.4` — CSV only.
- **`xlsx ^0.18.5` — ALREADY A DEPENDENCY**, installed at `0.18.5`. This is the
  package the prompt says not to use. It is imported in exactly one place:
  `src/app/api/forecasting/import/route.ts:5`, where `XLSX.read()` parses
  user-uploaded files **server-side**. It reads both `.xlsx` and `.xls`
  (BIFF; `cfb` is installed alongside it).
- Nothing else (`exceljs`, `read-excel-file`, …) is present.

So F8 is not "nothing reads .xlsx". Something does, and it is the package
already ruled unsafe, already running on an upload path. That is an
out-of-scope finding (§ Triage, T1).

Note: an `.xlsx` is a zip of XML. The BevSpot sales-items file uses inline
strings (no `sharedStrings.xml`) and two sheets. This audit read it with the
stdlib alone, so a parser needing **no dependency** is feasible for this one
format (zip inflate + a small XML walk). Node has `zlib` but no zip
container reader in its stdlib, so "no dependency" still means a small
hand-written zip central-directory reader.

### A5. `SalesItem` sync — variations only

`src/app/api/square/sales-items/sync/route.ts` lists
`/v2/catalog/list?types=ITEM,CATEGORY` and upserts one `SalesItem` per
`item_data.variations[]`. **No `MODIFIER` / `MODIFIER_LIST` objects are read
or stored.** Confirmed as expected: modifier rows are out of BEV-1's scope,
and add-on nutrition needs a later phase.

Caveat that matters for F7: BevSpot's "modifier groups" are **not**
necessarily Square modifiers. Many such rows carry a 24-char id that is a
**Square variation id present on dev** (e.g. `PREMIUM BLEND-INS`,
`SELECT BLEND-IN`, `ADD RED BULL`). Keva models some add-ons as sellable
items. So "is a modifier" cannot be decided by group name. The real test is
whether the id is a `SalesItem` (see B4).

### A6. Permissions and nav

- `docs/PERMISSIONS_INVENTORY.md:241-242, 472-473`: **IV-2** = inventory asset
  writes (incl. `recipes` writes), `inventory.assets.manage`, ADMIN + MANAGER.
  **IV-3** = bulk import (`ingredients/import`, `storage-areas/copy`),
  `inventory.import`, **ADMIN only**.
- `src/lib/permissions.ts:354`: `"inventory.import": ADMIN_ONLY`. **No route
  calls `can(actor, "inventory.import")`.** IV-3 is enforced by
  `requireAdmin()` in each handler, which is the same effective role and
  matches the inventory's "handler" column. BEV-1 should gate the same way:
  `requireModule("inventory")` + `requireAdmin()`, with
  `can(actor, "inventory.import")` acceptable as an equivalent.
- **Nav** (`src/components/layout/sidebar.tsx:107-117`): Inventory children are
  Ingredients, Sales Items, Recipes (`inventory.assets.manage`), Storage
  Areas, Counts, … The existing import is a button on `/inventory/ingredients`
  shown only to ADMIN (`ingredients-client.tsx:272`). **Recommendation:** no
  new sidebar entry. Put an ADMIN-only "Import from BevSpot" button on
  `/inventory/recipes` (header), opening a dedicated page at
  `/inventory/recipes/import/bevspot`. The page server-checks ADMIN and
  module; the APIs check it again.

---

## B. The real export, parsed in memory

### B1. Re-measured counts vs chat

| Measure | Chat | Measured | Note |
|---|---|---|---|
| Sheet rows (Sales Items) | — | 1,786 | |
| Item rows | ~1,494 | **1,496** | +2 |
| Menu groups | ~145 | **145** (all names distinct) | |
| "Archived" rows | 28 | **28** | |
| Rows with a 24-char Square-style id | 1,314 | **1,316** | +2 |
| …distinct ids | 1,116 | **1,118** | +2 |
| Rows without one | — | **180** (26 null, 154 names/codes) | |
| Distinct Square ids with a recipe | 867 | **867** | |
| …with ≥2 different recipes | 45 | **45** (same raw or whitespace/case-normalized) | |
| …with 3 different recipes | — | **7** | |
| Distinct Square ids with no recipe on any row | — | **251** | |
| Rows with a recipe / recipe lines | — | **1,121 / 3,706** | |
| Rows with a negative qty | 12 | **12** — all in modifier-style groups plus 1 "Unassigned" | |
| Distinct referenced names | ~276 | **276** (276 normalized too) | |
| Names containing a comma | — | **7** (`Hershey Topping, Chocolate…`, 4× `Chef's Line Cake, …`, `Monogram Container, Pet Plastic 16 oz`, `Sweet Street Pretzel Dog, All Beef 6 oz`) | |
| Names with a double space | — | **23** | |
| Distinct units | — | **38** (§ A1) | |
| Recipe strings the tokenizer could not split | — | **0** | |
| Names not products in the inventory export | ~166 | **NOT RE-MEASURED** | The `.xls` is true BIFF (`CDFV2 Microsoft Excel`). The only BIFF reader on this machine is `xlsx@0.18.5`, which the prompt bars, and Python has no `xlrd`. Not needed under F5 (match is against Froot ingredients, not the inventory file). |

Tokenizer used, for the record (it is the approach Phase 2 needs). Split
on **top-level** commas, outside parentheses. A piece with no trailing
balanced `(<number> <unit>)` group is glued to the next piece. The
quantity group is the last balanced top-level parenthetical. This kept all
7 comma names whole **without** a known-names list, and handled nested units
(`1 bottle (1L)`, `0.181 container (96oz (dry))`) and names that end in
parentheses (`Chocolate Syrup Drizzle (1 pump) (1 serving)`).

**Structural surprise: an "Unassigned" block of 201 rows** whose `Menu Group`
cell is empty. It is the only place the block header and the column
disagree. 44 of its rows carry Square ids and 153 have recipes. It appears to
hold **older names for live items**. `All That Razz (12oz)/(24oz)/(32oz)`
there share ids with `All That Razz (Kids)/(M)/(L)` in "Berry Blends".

### B2. The 45 conflicting Square ids, classified

| Class | Count |
|---|---|
| F3's literal case — one row is a single-line wrapper naming **the item itself** | **1** (`Lemon Berry Zinger w/ Poppin' Boba (12oz)`). It **is** self-referencing, so in Froot it would be a loop. |
| One expanded recipe + one wrapper naming **another** sales item | **9** (e.g. `Bulls Eye (24oz)` → `Bulls Eye (M) (1 serving)`, `Apple Pie Smoothie (12oz)` → `Apple Pie Smoothie (Kids) (1 serving)`) |
| Two expanded recipes that disagree + one wrapper | **5** (e.g. `Green Giant (12oz.)` vs `Green Giant Juice Blend (Kids)` + wrapper) |
| Two genuinely different expanded recipes | **27** |
| Three genuinely different expanded recipes | **2** |
| Two single-line rows, both a product/item name | **2** (`FELZEY…`: `Almond Milk (4 fl. oz)` vs `Coconut Milk (1 fl. oz)` — two different modifiers on one id; `CHMURF…`: a drizzle wrapper vs its own expanded line) |

Patterns inside the "genuinely different" 29:
- **Renamed items:** `Banana Matcha Smoothie (S/M/L/Kids)` and
  `Green Goddess (S/M/L/Kids)` share four ids. Different names, different
  recipes.
- **Duplicate rows for one item in one group:** `Strawberry Squeezer (L)`
  twice (banana 2.6 vs 2.32 oz); `Tropical Fusion (L)/(M)` twice;
  `Green Giant Juice Blend (L)/(S)` twice.
- **Old vs current:** 9 of the 45 dissolve if Archived and Unassigned rows
  are dropped **before** conflict detection. **36 remain.**

Full per-id listing (rows, groups, raw recipes) was produced in the
scratchpad and is reproducible by the Phase 2 planner. It is not pasted here
because it is Keva data (prompt: "No real Keva data in the repo").

### B3. Referenced names vs Froot (dev `br-broad-wave-a6vpjdw0`, org `cf888f2d-…`)

| Bucket | Count |
|---|---|
| Exact name match to a Froot `Ingredient` | **0** |
| Match after whitespace-collapse + case-fold | **0** |
| Match to a Froot sub-recipe (`Recipe.salesItemId` null) | **0** (dev has 0 recipes) |
| **No match** | **276** |

`br-broad-wave-a6vpjdw0` — dev's 8 ingredients (none deleted, all active):
`Raspberry Juice Blend`, `Rainbow Sherbet`, `Bananas (sliced)`,
`Strawberries (sliced)`, `Cup - 32oz`, `Lid - 32oz`, `Spoon (long)`,
`Napkin`. These are the `scripts/seed-razz-fixture.ts` fixture, not Keva's
catalog. **This bucket is meaningless on dev; § C query 3 is how to measure
it.**

What the 276 no-match names actually are, from the export itself:
- **151** are names that appear only as recipe lines: products (cups, lids,
  syrups, fruit, `Langers Pomegranate Juice`, `Red Bull …`, `Whey Protein …`).
  These are what Froot `Ingredient`s must exist for.
- **11** are BevSpot prep/kit rows with no Square id: `Cup Kit - 12oz`,
  `- 20oz`, `- 24oz`, `- 32oz`, `- Acai Bowl`, `Juice - Celery 1 oz Serving`,
  `Juice - Cucumber 1oz`, `Juice - Ginger 1 oz`, `Kale - 1 oz portion`,
  `Tahoe Lemonade - 1 oz`, `Add Honey`. **All 11 have recipes in the export.**
- **97** resolve to Square-linked sales rows (a sales item used as a
  sub-recipe; headline 2).
- **17** are the same-named product/item collisions (headline 3).
- 13 names that are defined in the export have **2+ defining rows that
  disagree** (`Soy Milk`, `Celery`, `Honey`, `Almond Milk`, `Chia Seeds`,
  `Coconut Flakes`, `Hemp Seeds`, `Pitaya (Dragon Fruit)`, `All That Razz
  (L)/(M)`, `Tropical Fusion (M)`, `Oreo Crumble Topper`, `Add Honey`). A
  name-keyed sub-recipe lookup there is ambiguous.
- The "Batch Recipe" group (5 rows) holds `Carrot`, `Chia Pudding - 1oz`,
  `Coconut water - 1 oz`, `Kale - 1 oz portion`, `Orange Juice - 1oz`. Chat
  was right that these mostly don't match the names recipes reference.

### B4. Square ids vs dev `SalesItem` (`br-broad-wave-a6vpjdw0`, org `cf888f2d-…`)

| Measure | Count |
|---|---|
| Dev `SalesItem` rows for the org | 1,179 (all `recipeStatus = UNMAPPED`) |
| Distinct Square ids in the export | 1,118 |
| …present as `SalesItem.squareVariationId` | **592** (all `isDeleted = false`) |
| …of those, already with a `Recipe` | **0** |
| Square ids **with a recipe** in the export | 867 |
| …present on dev | **520** |
| Dev sales items whose id is **not** in the export | 587 |

Only about half of the export's ids exist on dev. That is consistent with
dev's catalog sync being older than Keva's current Square catalog, or with
BevSpot holding stale ids. It cannot be told apart from dev; § C query 4
answers it on staging and production.

`MenuItem` / `MenuItemNutrition` / `MenuItemAllergen` for the org on
`br-broad-wave-a6vpjdw0`: **0 / 0 / 0.**

---

## C. SQL for Gary — Neon console, staging then production

Claude does not connect to either branch. **Deviation from the prompt,
flagged:** the prompt asks for a hand-typed `'br-square-feather' AS branch`
literal. CLAUDE.md **R4** (2026-10-24) forbids exactly that, so every query
below selects `current_setting('neon.branch_id', true)`, the value the server
reports. Check it against the console's branch dropdown when you paste
results back.

The org is resolved **per branch** (CLAUDE.md: a row id does not identify a
branch), so run query 1 first on each branch and paste that branch's org id
into 2–4.

```sql
-- 1. Resolve Keva's org on THIS branch (do not reuse an id from another branch)
SELECT current_setting('neon.branch_id', true) AS branch_id,
       o.id, o."clerkOrgId", o.name,
       (SELECT count(*) FROM "Store"      s WHERE s."organizationId" = o.id) AS stores,
       (SELECT count(*) FROM "SalesItem"  x WHERE x."organizationId" = o.id) AS sales_items,
       (SELECT count(*) FROM "Ingredient" i WHERE i."organizationId" = o.id) AS ingredients
FROM "Organization" o
ORDER BY sales_items DESC
LIMIT 10;
```

```sql
-- 2. Counts for that org. Replace :org with the id from query 1 ON THIS BRANCH.
WITH org AS (SELECT ':org'::text AS id)
SELECT current_setting('neon.branch_id', true) AS branch_id,
  (SELECT id FROM org) AS org_id,
  (SELECT count(*) FROM "Ingredient" i, org WHERE i."organizationId" = org.id
     AND i."deletedAt" IS NULL AND i."isActive" AND NOT i."isArchived")      AS ingredients_active,
  (SELECT count(*) FROM "Ingredient" i, org WHERE i."organizationId" = org.id
     AND i."deletedAt" IS NULL)                                              AS ingredients_not_deleted,
  (SELECT count(*) FROM "Recipe" r, org WHERE r."organizationId" = org.id
     AND r."salesItemId" IS NOT NULL)                                        AS recipes_with_sales_item,
  (SELECT count(*) FROM "Recipe" r, org WHERE r."organizationId" = org.id
     AND r."salesItemId" IS NULL)                                            AS sub_recipes,
  (SELECT count(*) FROM "SalesItem" x, org WHERE x."organizationId" = org.id
     AND x."recipeStatus" = 'UNMAPPED')                                      AS si_unmapped,
  (SELECT count(*) FROM "SalesItem" x, org WHERE x."organizationId" = org.id
     AND x."recipeStatus" = 'MAPPED')                                        AS si_mapped,
  (SELECT count(*) FROM "SalesItem" x, org WHERE x."organizationId" = org.id
     AND x."recipeStatus" = 'NON_RECIPE')                                    AS si_non_recipe,
  (SELECT count(*) FROM "SalesItem" x, org WHERE x."organizationId" = org.id
     AND x."isDeleted")                                                      AS si_deleted,
  (SELECT count(*) FROM "MenuItem" m, org WHERE m."organizationId" = org.id) AS menu_item,
  (SELECT count(*) FROM "MenuItemNutrition" n JOIN "MenuItem" m ON m.id = n."menuItemId", org
     WHERE m."organizationId" = org.id)                                      AS menu_item_nutrition,
  (SELECT count(*) FROM "MenuItemAllergen" a JOIN "MenuItem" m ON m.id = a."menuItemId", org
     WHERE m."organizationId" = org.id)                                      AS menu_item_allergen,
  (SELECT count(*) FROM "MenuItem")                                          AS menu_item_all_orgs;
```

```sql
-- 3. ADDED (not in the prompt): ingredient names, so B3 can be measured for real.
--    Dev has only an 8-row fixture. Paste the output back; Claude matches it
--    in memory against the export. Names + units only, no costs.
SELECT current_setting('neon.branch_id', true) AS branch_id,
       i.name, i."reportingUnit", i.kind, i."isActive", i."isArchived"
FROM "Ingredient" i
WHERE i."organizationId" = ':org' AND i."deletedAt" IS NULL
ORDER BY i.name;
```

```sql
-- 4. ADDED: existing recipes by name (for F6/F10, and to see whether a Cup Kit
--    or juice-portion sub-recipe was already hand-built).
SELECT current_setting('neon.branch_id', true) AS branch_id,
       r.name, (r."salesItemId" IS NOT NULL) AS has_sales_item,
       r."yieldQty", r."yieldUnit", count(l.id) AS lines
FROM "Recipe" r LEFT JOIN "RecipeLine" l ON l."recipeId" = r.id
WHERE r."organizationId" = ':org'
GROUP BY r.id
ORDER BY r.name;
```

Queries 3 and 4 return Keva's names into the chat transcript. Neither is
written to the repo.

---

## D. Forks — chat's lean, what the data says, my recommendation

Leans are **chat's**, not Gary's rulings (memory rule: anything Gary did
not object to is a recommendation, not a ruling).

**F1 — Where nutrition lives.** Lean: computed from ingredients through
recipes; `MenuItem*` untouched, DEBT row to retire it after N-3.
*Data:* `br-broad-wave-a6vpjdw0` org `cf888f2d-…` holds 0/0/0 `MenuItem*`
rows. Staging and production are pending § C query 2. The existing N-1 row
still describes the stub ("MenuItem/MenuItemNutrition/MenuItemAllergen
models … scaffolded"), and N-2/N-3 carry blockers keyed to it, so all three
need riders. *Recommendation:* the lean.

**F2 — Master export.** Lean: one export (Las Brisas #14) writes org-level
recipes for all stores; other stores never imported. *Data:* consistent.
Recipes are org-scoped and `SalesItem` is unique on
`(organizationId, squareVariationId)`. *Recommendation:* the lean.

**F3 — Conflicting recipes for one Square id.** Lean: use the expanded row
when the other is a wrapper naming the item itself; otherwise import neither
and list both. *Data:* the literal rule fires **once**, and that one wrapper
is self-referential (a loop). The common wrapper names **another** sales
item (9 + 5). *Recommendation:* (a) drop Archived and Unassigned rows first
(dissolves 9 conflicts, leaving 36). (b) If exactly one remaining row is
expanded and the rest are wrappers to *other* items, use the expanded row.
(c) Otherwise import neither and list all. Needs Gary's word on (a). It
treats "Unassigned" as stale, which the evidence suggests but does not
prove.

**F4 — Sub-recipes not defined in the export.** Lean: link by exact name to
an existing Froot sub-recipe or skip; never invent an empty one. *Data:*
mostly moot. The Cup Kits and juice portions **are** defined in the export
(headline 1). The "never invent an empty sub-recipe" principle stands. A
genuinely undefined name stays MISSING_SUBRECIPE. *Recommendation:* keep the
principle, and decide F10 instead.

**F5 — Unmatched ingredients.** Lean: exact after whitespace-collapse and
case-fold, or nothing. Skip any recipe with an unmatched line. "Did you
mean" may be shown, never applied. *Data:* 151 product names must exist as
Froot ingredients. The match rate is unknown until § C query 3. Double spaces
(23 names) make the whitespace collapse essential. *Recommendation:* the
lean.

**F6 — Existing recipes.** Lean: never overwrite; skip and count sales items
that already have a recipe; idempotent re-run. *Data:* dev has 0 recipes.
Staging/prod pending § C. `Recipe.salesItemId @unique` enforces it at the DB
for sales-item recipes. For **sub-recipes** created under F10 there is no DB
guard (`Recipe.name` is not unique), so idempotency there has to be by
exact name. A re-run must find the Cup Kit it created last time, not make a
second one. *Recommendation:* the lean, plus that sub-recipe rule.

**F7 — Modifier rows, negatives, Archived, non-Square ids.** Lean: all
skipped and counted. *Data:* the negative rows (12) are rejected by
`RecipeLineSchema.amount.positive()` anyway. "Modifier" cannot be judged by
group name (A5): many add-on rows are real Square variations on dev.
*Recommendation:* skip negatives, Archived, and non-Square-id rows **as
sales-item recipes**. Classify "modifier" as *Square id not a `SalesItem`*
(NOT_IN_SQUARE) rather than by group name. A non-Square-id row may still be
used **as a sub-recipe definition** if F10 rules yes.

**F8 — Parser dependency.** Lean: `.xlsx` only, smallest maintained
dependency, never `xlsx@0.18.x`. *Data:* `xlsx@0.18.5` is **already a
dependency** and already parses uploads in `forecasting/import` (§ T1).
*Options:* (i) a hand-written reader (no new dependency; zip central
directory + inflate via `zlib` + an XML walk of the inline-string sheet). Its
scope is narrow, since it only needs to read this one export shape.
(ii) `exceljs` (maintained, `.xlsx` only, heavier). (iii) the SheetJS CDN
build `xlsx@0.20.x`, patched but not on the npm registry. *Recommendation:*
(i). The file shape is simple and fixed, and it adds nothing to
`package.json`. RULING NOW whichever way.

**F9 — Schema.** Lean: none; one AuditLog row per apply. *Data:* confirmed
no column is needed. **But `writeAuditLog` (`src/lib/audit.ts`) uses the
global client and swallows failures by design** ("NEVER block the user
action"). If the AuditLog row is the only record an undo can be built from,
the apply must write it **inside the same `$transaction`** via
`tx.auditLog.create`, so it cannot silently go missing.
*Recommendation:* the lean, with the in-transaction write.

**F10 — NEW: recipes the export defines for referenced names.** Two kinds:
(a) **11 prep/kit rows with no Square id** (Cup Kits, juice portions);
(b) **97 names** that resolve to Square-linked sales rows used as
sub-recipes. Options:
- **A:** create (a) as Froot sub-recipes (`salesItemId` null) from their
  export rows. For (b), make the line a `subRecipeId` pointing at the
  **target sales item's** imported recipe. Both are created only if every
  line of theirs resolves, and are loop-checked across the whole batch.
- **B:** create (a) as sub-recipes, but for (b) skip the referencing recipe
  as MISSING_SUBRECIPE.
- **C:** the prompt's lean: skip everything that references either kind.

Under C, a very large share of smoothies would skip (nearly every one
carries a Cup Kit). *Recommendation:* **A**. Sub-recipe yield is `1 serving`,
which matches the `(N serving[s])` lines used to reference them. Caveat: a
sales item's recipe used as a sub-recipe means editing `Bulls Eye (M)`
silently changes `Bulls Eye (24oz)`. That is faithful to BevSpot and is how
Froot's cost engine already propagates.

**F11 — NEW: product/item name collisions.** 17 names are both a product and
a sales item (`Chia Seeds`, `Honey`, `Coconut Water`, `Almond Milk`, …).
*Recommendation:* a line resolves to a **Froot ingredient first**, and to an
export-defined recipe only if no ingredient matches. This makes
`Chia Seeds → Chia Seeds (1 oz (dry))` an ingredient line rather than a
self-loop. A name defined by 2+ export rows that disagree is ambiguous and
skips the referencing recipe (13 such names).

**F12 — NEW: whole-package quantities.** 38 rows use ≥1 whole package / tub
/ case / bag / container (e.g. `Honey (1 package (5lbs))`). Options: import
faithfully; or import but flag in the preview; or skip as SUSPECT_QTY until
fixed in BevSpot or Froot. *Recommendation:* skip and list. The lean's own
logic is "a wrong recipe is worse than none", and an 80 oz-of-honey smoothie
is wrong.

**F13 — NEW: unconvertible units `g`, `unit`, `other (1 unit)`.** `g` (65
lines, protein powders, matcha, cinnamon, the Element paks) is a mass unit
and converts without a density. *Recommendation:* add `g` to `UNIT_INFO`
(weight, `toBase` 0.035274). That is a small code change to a shared file
that every recipe screen's unit picker reads, which is why it is a ruling
and not a default. `unit` / `other (1 unit)` → BAD_UNIT, skip, list. It
lands mostly on the Cup Kits (`Straws (1 unit)`), so under F10-A Gary would
either fix the straw unit in Froot or accept that Cup Kits skip until he
does.

---

## Triage — out-of-scope findings

- **T1 — RULING NOW.** `xlsx@0.18.5` is a production dependency parsing
  user-uploaded files server-side in `src/app/api/forecasting/import/route.ts`.
  It is the version the BEV-1 prompt bars for its advisories. Out of BEV-1's
  scope to fix, but Gary should decide now whether it becomes a ROW (swap
  for whatever F8 picks) or is accepted as-is (forecast import is ADMIN-only
  and fed the user's own files).
- **T2 — COMMENT.** `inventory.import` is defined `ADMIN_ONLY` and mapped to
  IV-3 in `PERMISSIONS_INVENTORY.md`, but no code calls it; every IV-3 handler
  uses `requireAdmin()`. The effective gate is identical, so nothing is
  wrong today. Noting it so BEV-1 does not mistake the capability for the
  enforced gate.
- **T3 — COMMENT.** Recipe create/update (IV-2) writes no AuditLog, while
  BEV-1's apply will. Not a defect; asymmetry noted.
- **T4 — FIX NOW (Phase 3, already instructed).** `docs/prompts/BEV-1.md`'s
  export paths are wrong (`bevspot-exports/…__14…`). Gary ruled in chat to
  correct them to the Downloads `#14` paths before the prompt is first
  committed. Flagged because CLAUDE.md treats `docs/prompts/` files as
  claims never edited. This edit is legitimate only because the prompt has
  never been committed and Gary directed it, and the commit message should
  say so.
- **T5 — COMMENT.** Dev's Keva catalog holds only 592 of the export's 1,118
  Square ids. If staging/prod show the same gap, a Square catalog re-sync
  (`/api/square/sales-items/sync`, read-only toward Square) before running
  BEV-1 is Gary's call. It is not something BEV-1 does.

No ROW proposed from this phase.

---

## Commands run this phase (verbatim intent)

- No `prisma` CLI command was run. No `npm run build`. The throwaway dev
  reader imported `src/lib/prisma.ts` (Prisma client queries only, reads
  only) via `npx tsx`.
- No file in the repo was created or changed except this audit file.
