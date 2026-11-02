# N-2 audit — Nutrition Facts label with selectable serving size

TIER 3, Phase 1 (read-only). Written 2026-11-02 by the N-2 session before its
report. Prompt of record: `docs/prompts/N-2.md`. No code, schema or docs were
changed. Every database result below names its branch; the branch id comes
from `current_setting('neon.branch_id', true)` in the same query.

Repo gate (Phase 0): `pwd` → `/Users/garythomas/Claude_Projects/Froot/froot`
(lowercase); `git status` → `staging`, up to date with `origin/staging`, only
`docs/prompts/N-2.md` untracked; HEAD `22b8a7f` (`Merge branch 'staging'`),
then `aba8c57`, `d8b6c39`.

---

## A. Sizes in the data

### How size is represented

- `SalesItem` is one row **per Square variation** (`@@unique([organizationId,
  squareVariationId])`). Size is the **variation name**: `SalesItem.variationName`
  (string, `"Regular"` when Square sends none —
  `src/app/api/square/sales-items/sync/route.ts:96`). `displayName` is built as
  `` `${itemName} (${variationName})` `` (`:107`, `:116`). There is no size
  column, no size enum and no volume anywhere on `SalesItem`.
- A menu recipe hangs off one variation: `Recipe.salesItemId @unique`. So a
  label is per variation, and **a label finds its item's size as
  `recipe.salesItem.variationName`**. `/nutrition/menu` already loads every
  `SalesItem` with its recipe (`src/app/(app)/nutrition/menu/page.tsx:32-37`).
- `Recipe.servingSizeQty` / `servingSizeUnit` exist but mean something else:
  the recipe editor uses them as the **default amount when the recipe is added
  as a sub-recipe line** (`src/app/(app)/inventory/recipes/[id]/recipe-editor-client.tsx:177-178`).
  N-2 must not reuse them for the label — repurposing would change what the
  recipe editor pre-fills. On dev, 0 sales recipes have them set (below).
- The "cup kit" (`Cup Kit - 20oz`, a prep recipe a drink recipe includes —
  `docs/DECISIONS.md:341`, `recipes-client.tsx:293`) carries volume only in its
  name. Per the prompt's F3 lean it is not a volume source.

### Distinct size names — dev

`br-broad-wave-a6vpjdw0` (dev, local `.env`), org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (Keva Juice), non-deleted `SalesItem`:
**1,179 items**, the only org on dev with sales items.

`br-broad-wave-a6vpjdw0` — **`Recipe` is EMPTY on dev (0 rows, every org).**
Every "with recipe" count below is therefore 0. The ~454 menu recipes the
prompt cites exist on production (and possibly staging), not dev. Consequence
for Phase 3: the label cannot be exercised end-to-end against Keva data
locally; the fixture is pure and the real-data check is Gary's staging pass.

Top variation names on `br-broad-wave-a6vpjdw0`, Keva
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd` (items):

| variationName | items | | variationName | items |
|---|---|---|---|---|
| `Regular` | 280 | | `20oz` | 24 |
| `L` | 117 | | `32oz` | 23 |
| `M` | 115 | | `Full Dozen` | 15 |
| `S` | 97 | | `Regular Price` | 13 |
| `Kids` | 91 | | `24 Count` / `Half Dozen` | 7 / 7 |
| `16oz.` | 46 | | `XL`, `2XL`, `Large` | 4 each |
| `20oz.` | 44 | | `24oz`, `12oz`, `16oz`, `Small`, `XS`, `3XL` | 3 each |
| `12oz.` | 41 | | ~150 others (T-shirt colour/size, mugs, bouquets) | 1–2 each |

By menu group (`br-broad-wave-a6vpjdw0`, Keva, T-shirt groups excluded):

| Menu group | Variation names |
|---|---|
| Berry / Island / All Fruit / Orchard / Power / Probiotic / Tempters / Green Smoothies / Season Specials | `Kids \| S \| M \| L` |
| Red Bull Blends, Protein Blends | `M \| L` |
| Tahoe Lemonade Smoothies | `20oz \| 32oz \| Kids \| S \| M \| L` |
| Tahoe Lemonade Lemonades | `20oz \| 32oz` |
| Juice Blends | `12oz \| 24oz \| Kids \| S \| M \| L \| Small \| Regular` |
| Keva Coffee | `12oz. \| 16oz \| 16oz. \| 20oz \| 20oz. \| Regular` |
| Event Smoothies | `12 oz \| 24 oz \| 32 oz \| Regular \| ""` |
| Juice Shots | `20oz \| Double Shot - 2oz` |
| **Archived** | `Kids (12oz) \| Small (20oz) \| Medium (24oz) \| Large (32oz)` + `12oz \| 20oz \| 24oz \| 32oz` + `Kids \| S \| M \| L` |
| Acai Bowls, Vegan Cookies, Pretzels, Pastries, Supplements, Events Food, Red Bull Infusions, Other Beverages | `Regular` (and flavour names) |
| Fruit Bouquets / Strawberries | `Regular \| Small \| Large \| Half Dozen \| Full Dozen \| 24 Count …` |
| Retail | `XS … 3XL \| Cream \| Peach \| Regular` (shirt sizes) |

**Findings from the names:**

1. **The archived items carry the size meaning in their names**:
   `Kids (12oz)`, `Small (20oz)`, `Medium (24oz)`, `Large (32oz)`. That matches
   the prompt's example exactly (Kids 12, S 20, M 24, L 32) and is the best
   evidence in the data for what the live `Kids/S/M/L` mean. It is still the
   ADMIN's table to fill (the prompt says so); this is a sanity check for it.
2. **Coffee and lemonade sizes are already volumes in the name**, in four
   spellings: `12oz.`, `12oz`, `12 oz`, `32 Oz.`. A table keyed on the exact
   string needs a row per spelling (`20oz.` and `20oz` are two rows). See
   N2-F6.
3. **Names collide across product types.** `L`/`M`/`S` are smoothie sizes
   AND shirt sizes (Retail); `Small`/`Large` are a Juice Blends size AND a
   fruit-bouquet size. An org-wide table keyed on the name gives every item
   with that name the same volume. Only items with a recipe get a label, and
   shirts have none, so the shirt collision is harmless today; a bouquet with
   a recipe would not be. The per-item override must therefore be able to say
   **"per item (whole item = 1 serving)"**, not only "a different volume".
4. `Regular` (280) covers drinks too — Red Bull Infusions, Events Beverage,
   Soda / Water, coffee `Regular`. Under F1 those fall to "per item" unless
   the ADMIN gives `Regular` a volume (which would also hit every bowl and
   cookie — don't) or overrides the item.
5. Blank names exist (`""`, 2 items: Event Smoothies, Pretzels).

### Production query for Gary (read-only)

Run in the Neon console on the **production** branch. The branch id is
reported by the server in the first column — nothing is typed (R4).

```sql
SELECT current_setting('neon.branch_id', true) AS neon_branch_id,
       s."variationName",
       count(r.id)                                   AS items_with_recipe,
       count(*)                                      AS items_total,
       string_agg(DISTINCT coalesce(s."menuGroup", '(none)'), ' | ') AS menu_groups
FROM "SalesItem" s
LEFT JOIN "Recipe" r ON r."salesItemId" = s.id
WHERE s."organizationId" = 'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'
  AND NOT s."isDeleted"
GROUP BY s."variationName"
HAVING count(r.id) > 0
ORDER BY items_with_recipe DESC, s."variationName";
```

Only names on items **with a recipe** are listed — those are the only ones a
label will ever look up, so they are the size table's rows.

---

## B. FDA rules (cited)

**Source status.** All three eCFR pages (`ecfr.gov` 101.9 / 101.11 / 101.12)
answered with a 302 to `unblock.federalregister.gov` and no regulation text;
the redirect was not followed. **Read instead: Cornell LII**
(`law.cornell.edu/cfr/text/21/101.9`, `/101.11`, `/101.12`), which reproduces
the e-CFR but shows no "current as of" date — so currency against today's eCFR
edition is **not confirmed**. The same source N-1c/N-1d cite
(`label-review.ts:186-205`). Not visible on LII: the (d)(12) sample label
graphics, and the "levels of significance" column of the (c)(8)(iv) table.
Quotes are short; `[derived]` marks arithmetic, not regulation text.

### B1. Serving size declaration — 101.9(b)(5)(viii), (b)(7)

- (b)(7): the serving size is "expressed in common household measures … and
  shall be followed by the equivalent metric quantity in parenthesis (fluids
  in milliliters …)".
- **(b)(5)(viii): "1 fl oz means 30 mL"** (a cup 240 mL). So **12 fl oz is
  360 mL, not 355** as the prompt's example reads. 101.12 Table 2 prints the
  beverage RACC as "12 fl oz (360 mL)". `[derived]` 8 → 240, 16 → 480,
  20 → 600, 24 → 720, 32 → 960 mL.
- (b)(7)(ii): metric "should be rounded to the nearest whole number" (≥5 mL).
- (b)(7)(iv): abbreviations "fl oz", "mL" allowed.
- (d)(3)(ii): "Serving size" in bold.

### B2. Servings per container — 101.9(b)(8)(i), (b)(6)

- (b)(8)(i): "rounded to the nearest whole number except for the number of
  servings between 2 and 5 … rounded to the nearest 0.5 serving. Rounding
  should be indicated by the use of the term about".
- **(b)(6) — the single-serving rule, which changes the prompt's math:** "A
  product that is packaged and sold individually that contains less than 200
  percent of the applicable reference amount must be considered to be a
  single-serving container, and the entire content of the product must be
  labeled as one serving." For 150 % to under 200 % a voluntary extra column
  "per common household measure that most closely approximates the reference
  amount" is allowed.
- (d)(3)(i): no "servings per container" line on a single-serving container.

`[derived]` at a 12 fl oz reference:

| Item | % of 12 | FDA servings per container | Columns |
|---|---|---|---|
| Kids 12 | 100 % | single serving (12 fl oz) | one |
| S 20 | 167 % | **single serving (20 fl oz)** — not 1.67, not "2" | one (+ optional per-12 column) |
| M 24 | 200 % | **2 servings** | **dual required** (b)(12) |
| L 32 | 267 % | **about 2.5** (2.67 → nearest 0.5) | **dual required** |
| 40 | 333 % | about 3.5 | dual voluntary |

`[derived]` at an 8 fl oz reference (see RULING NOW R-1): Kids 12 = 150 % →
single; S 20 = 250 % → about 2.5, dual required; M 24 = 300 % → 3, dual
required; L 32 = 400 % → 4, dual not required.

**What "per serving" means at "about 2.5".** The declared serving is the
serving size (12 fl oz), so per-serving amounts are totals × 12 / 32 (÷ 2.67),
**not** totals ÷ 2.5. The prompt's "per-serving = totals ÷ servings per
container" is right only if "servings per container" means the unrounded
ratio. See R-2.

### B3. Dual columns — 101.9(b)(12), (e)(6)

- (b)(12)(i): individually packaged products "that contain at least 200
  percent and up to and including 300 percent of the applicable reference
  amount must provide an additional column" — per serving and per entire
  package. Exemptions (b)(12)(i)(A)–(C) (tabular/linear small formats; raw
  produce/seafood; foods needing preparation, eaten with another food, etc.)
  don't fit a finished drink.
- (e)(6): the two columns are "separated by vertical lines"; (e)(6)(i)
  vitamins/minerals below a bar in the order Vitamin D, calcium, iron,
  potassium. (d)(4): "Amount per serving" not required in dual format.
- Below 200 % FDA requires one column; above 300 % it requires one column
  (dual voluntary). The prompt's F2 ("dual whenever servings > 1") is **wider
  than FDA requires** — a voluntary extra; nothing read forbids it above 300 %.

### B4. Calories — 101.9(c)(1)

"to the nearest 5-calorie increment up to and including 50 calories, and
10-calorie increment above 50 calories, except that amounts less than 5
calories may be expressed as zero."

### B5. Nutrients — 101.9(c)(2)–(c)(7)

| Nutrient | Rule (101.9) |
|---|---|
| Total fat (c)(2), saturated (c)(2)(i), trans (c)(2)(ii) | <0.5 g → 0; "nearest 0.5 (1/2) gram increment below 5 grams and to the nearest gram increment above 5 grams". **Exactly 5 g is not addressed.** |
| Cholesterol (c)(3) | nearest 5 mg; <2 mg → 0 (or omit); 2–5 mg "may be stated as 'less than 5 milligrams'" |
| Sodium (c)(4) | <5 mg → 0; 5–140 mg nearest 5; >140 mg nearest 10 |
| Total carbohydrate (c)(6), dietary fiber (c)(6)(i), total sugars (c)(6)(ii), added sugars (c)(6)(iii), protein (c)(7) | nearest gram; <1 g "less than 1 gram" may be used; <0.5 g may be 0 |
| Added sugars (c)(6)(iii) | declared indented under total sugars as "Includes X g Added Sugars" |

### B6. Vitamins and minerals — 101.9(c)(8)

- (c)(8)(ii): mandatory "vitamin D, calcium, iron, and potassium in that
  order", amount + %DV.
- Units (c)(8)(iv): vitamin D mcg; calcium, iron, potassium mg.
- **Amount rounding — NOT CONFIRMED.** (c)(8)(iii) says amounts use "the
  units of measurement and the levels of significance given in paragraph
  (c)(8)(iv)"; that column was not visible on LII. → RULING NOW R-5.
- %DV (c)(8)(iii): "nearest 2-percent increment up to and including the
  10-percent level, the nearest 5-percent increment above 10 percent and up
  to and including the 50-percent level, and the nearest 10-percent increment
  above the 50-percent level." Below 2 %: "0" or an asterisk + "Contains less
  than 2 percent of the Daily Value…".

### B7. %DV for macronutrients — 101.9(d)(7)(ii)

"calculated by dividing either the amount declared on the label for each
nutrient or the actual amount of each nutrient (i.e., before rounding) by the
DRV", "expressed to the nearest whole percent". **Either basis is allowed.**
→ R-4.

### B8. Daily Values — 101.9(c)(9), (c)(7)(iii), (c)(8)(iv)

Adults and children ≥ 4: fat 78 g, saturated fat 20 g, cholesterol 300 mg,
sodium 2,300 mg, total carbohydrate 275 g, dietary fiber 28 g, added sugars
50 g, protein 50 g ((c)(7)(iii) and (c)(9)); vitamin D 20 mcg, calcium
1,300 mg, iron 18 mg, potassium 4,700 mg ((c)(8)(iv)). No DV for trans fat or
total sugars. **These match `FDA_DAILY_VALUES` in `src/lib/label-review.ts:190-192`
exactly** (the N-1c table, sourced from FDA's reference guide), so N-2 reuses
that constant — one table, now confirmed against the regulation too.

### B9. Footnote and order — 101.9(d)(9), (c)

- (d)(9): "*The % Daily Value tells you how much a nutrient in a serving of
  food contributes to a daily diet. 2,000 calories a day is used for general
  nutrition advice."
- Order (c): Calories; Total fat (Saturated, Trans indented); Cholesterol;
  Sodium; Total carbohydrate (Dietary fiber, Total sugars, Includes Added
  sugars indented); Protein; then Vitamin D, Calcium, Iron, Potassium. This is
  already `NUTRIENTS` order in `src/lib/nutrition.ts:11-27`.
- The exact visual layout (the (d)(12) sample graphic) was not visible; the
  label will follow the familiar 2016-format panel, not a pixel-checked copy.

### B10. Restaurants — 101.11 versus packaged labels — 101.9(j)(2)

- 101.11(a): covers a restaurant/similar retail food establishment "part of a
  chain with 20 or more locations doing business under the same name".
- (b)(2)(i)(A): calories on menus/boards for standard items "as usually
  prepared and offered for sale", rounded like (c)(1) (restated, not
  cross-referenced). (A)(9): beverage calories on "the full volume of the cup
  served without ice".
- (b)(2)(i)(B)/(C): the 2,000-calorie statement and "Additional nutrition
  information available upon request".
- (b)(2)(ii)(A): written information on request is a **list**, not a panel —
  calories, calories from fat, total fat, saturated fat, trans fat,
  cholesterol, sodium, total carbohydrate, dietary fiber, sugars, protein (no
  added sugars, no vitamins/minerals); "Rounding of these nutrients must be in
  compliance with § 101.9(c)". That is the only 101.9 cross-reference: **101.11
  borrows 101.9's rounding, not its panel, serving-size, servings-per-container
  or dual-column rules.**
- 101.9(j)(2)(i): food "Served in restaurants" is exempt from 101.9 labeling
  "Provided, That the food bears no nutrition claims or other nutrition
  information", "Except as provided in § 101.11".

**What this means for a made-to-order drink label** `[derived, not legal
advice]`: no rule *requires* Keva to print a Nutrition Facts panel for a
smoothie. If Keva is a 20+-location chain, 101.11 requires calories on the
menu board and the written list on request — rounded per 101.9(c). Anything
beyond that (panel format, serving size, servings per container, dual
columns) is Keva **choosing** to follow the packaged-food format. So N-2's
panel is "101.9 format, voluntarily", and the rounding is the part that is
genuinely mandatory under either regime. Whether Keva has 20+ locations, and
whether publishing a full panel (N-3) affects the (j)(2)(i) proviso, are
questions for Gary/counsel before N-3 — not N-2 decisions. (COMMENT.)

### B11. Reference amounts — 101.12 Table 2

| Category | RACC |
|---|---|
| Carbonated and noncarbonated beverages, wine coolers, water | 12 fl oz (360 mL) |
| Coffee or tea, flavored and sweetened | 12 fl oz (360 mL) prepared |
| Juices, nectars, fruit drinks; vegetable juice | **8 fl oz (240 mL)** |
| Milk, milk-based drinks, meal replacement | **8 fl oz (240 mL)** |
| Shakes or shake substitutes ("fruit frost mixes") | **8 fl oz (240 mL)** |

**Smoothies are not named.** The nearest categories (juices, shakes,
milk-based drinks) are all **8 fl oz**, not 12. The prompt's "12 fl oz is also
FDA's reference amount for beverages" holds for the "carbonated and
noncarbonated beverages" row and flavored coffee/tea — not obviously for a
fruit smoothie or a fresh juice. Because the (b)(6) single-serving and
(b)(12) dual-column thresholds are percentages **of the reference amount**,
this choice changes which sizes get one column vs two (table in B2). → R-1.

---

## C. Engine — one calculation path

- Per-item totals: `computeRecipeNutrition(graph, recipeId)` in
  `src/lib/recipe-nutrition.ts:133`, over `loadNutritionGraph(orgId)` (`:66`).
  Totals are **the whole recipe** = one sold item (`:17-18`), per nutrient a
  number or `null` (incomplete — never zero, `:105-106`). On a conversion
  error or loop every total is null and `error` is set (`:266`). Allergens are
  already the union over every line, sub-recipe and prepared source, exempt
  lines included (`:167`, `:208`, `:222-224`), sorted in statute order
  (`sortAllergens`, `nutrition.ts:59`).
- Verification: `itemVerification(n, proofOf)` → `VERIFIED | NOT_VERIFIED |
  NO_FOOD` (`src/lib/nutrition-proof.ts:120-128`); STALE ingredients make an
  item NOT_VERIFIED.
- Existing consumers: `/nutrition/menu` page (computes all) and
  `GET /api/nutrition/recipes/[id]` (NU-1, one recipe), both calling the same
  engine.

**How the label consumes it without a second path:** a new PURE module
(`src/lib/nutrition-label.ts`) that takes the engine's `RecipeNutrition`
output (`totals`, `allergens`, `error`, plus `itemVerification`) and a serving
spec (item volume or "per item", serving size), and returns the label model:
servings-per-container, column(s), each nutrient's rounded display string and
%DV, the allergen line, the honesty flags. It does arithmetic on the totals
only (scale by serving ÷ volume, then round) — it never walks recipes and
never reads the database, so there is exactly one nutrition calculation and
the label is a presentation of it. Being pure, it ships to the client so the
preview's serving-size picker re-renders instantly with no extra route, and
`scripts/verify-n2-label.ts` pins it without a database.

---

## D. Settings storage

Where org-level settings live today:

- **Columns on `Organization`** for single values: `paceAlertThresholdPct
  Int?` (null = fallback), `handoffNoteExpireDays`, `hrDateStampFormat`,
  `timezone`, the `*Enabled` switches.
- **A module settings model** where there are several: `LaborSettings`
  (`organizationId` + nullable `storeId`, `@@unique`), `MilestoneSettings`
  (1:1 `Organization.milestoneSettings`).
- No nutrition settings exist yet.

Smallest schema for the three things (all additive, no backfill):

1. **Drink serving size** — `Organization.nutritionServingFlOz Float?`, NULL =
   the default (12, or 8 per R-1). Same NULL-means-default shape as
   `paceAlertThresholdPct`. (A `NutritionSettings` 1:1 model is the
   alternative if more settings are expected; one column is smaller.)
2. **Size table** — new model `NutritionSizeVolume { id, organizationId,
   variationName String, volumeFlOz Float, @@unique([organizationId,
   variationName]) }`. Keyed on the variation name exactly as synced (see
   N2-F6 for normalisation).
3. **Per-item override** — new model `NutritionItemServing { id,
   organizationId, salesItemId @unique, perItem Boolean @default(false),
   volumeFlOz Float?, servingFlOz Float? }`. `perItem` exists because of
   finding A.3 (a name collision must be escapable to "whole item = 1
   serving"). **Kept off `SalesItem`** deliberately: `SalesItem` is
   Square-synced and upserted by `square/sales-items/sync`; a separate table
   means the sync can never touch an ADMIN's setting, and a deleted variation
   cascades its override.

Precedence (the prompt's "override beats table beats default"): item
`perItem` → per item; else item `volumeFlOz` ?? table[variationName] → volume,
or per item if neither; serving = item `servingFlOz` ?? org setting ?? default.

Units: fl oz only. A bowl or cookie is "per item", so no weight servings in
N-2.

---

## E. Permissions

Existing (`src/lib/permissions.ts:374-375`, N1-F3): `nutrition.view` =
OPERATIONAL (ADMIN, MANAGER, STORE); `nutrition.manage` = ADMIN_ONLY. Both
behind inventory AND nutrition modules (`nutrition-access.ts:18-20`,
`requireNutrition`). Neither is enforced/grantable per user.

N-2 surfaces (all new rows in `docs/PERMISSIONS_INVENTORY.md`):

| Surface | Gate |
|---|---|
| Label preview page `(app)/nutrition/menu/[salesItemId]/label` (or a dialog tab) — PG-38 | `nutrition.view` |
| Print view `src/app/print/nutrition-label/[salesItemId]` — PG-39 (outside the app shell, so it must repeat the module + capability gate itself) | `nutrition.view` |
| Serving settings page `(app)/nutrition/settings` — PG-40, + NV-18 sidebar entry | `nutrition.manage` |
| `nutrition/settings` GET/PUT (serving size + size table) — NU-9 | GET `nutrition.view` (the preview needs the table), PUT `nutrition.manage` |
| `nutrition/items/[salesItemId]/serving` PUT/DELETE (override) — NU-10 | `nutrition.manage`; org-scoped (salesItem resolved inside the org) |

The serving-size **picker** on the preview is view-only (it changes the
preview, saves nothing), so MANAGER/STORE can use it; saving the setting is
ADMIN. Writes get an `AuditLog` row, matching NU-2/NU-7.

---

## Forks — chat's leans, for Gary to rule

- **N2-F1 Default serving:** 12 fl oz for drinks; per item for anything not in
  the size table. *Audit note:* see R-1 — 12 is FDA's RACC for "beverages"
  and coffee/tea, 8 for juices, shakes and milk drinks; smoothies unnamed.
- **N2-F2 Dual column:** per serving + per container whenever servings > 1.
  *Audit note:* FDA requires it only at 200–300 %; F2 is a voluntary superset.
  Interacts with R-3 (below 200 %, FDA says one serving).
- **N2-F3 Item volume source:** org size table keyed by Square size name +
  per-item override; not the cup kit. *Audit note:* the override needs a
  "per item" setting (finding A.3).
- **N2-F4 Estimated items:** banner "Estimated — not for publication";
  missing nutrients "—". *Audit addition:* NO_FOOD items (nothing to verify)
  also get the banner, since N-3 publishes only VERIFIED; an item whose
  engine result has an error shows **no label**, just the error and a link
  to the recipe.
- **N2-F5 Rounding:** strictly 101.9(c) as read in B; unconfirmed rules are
  RULING NOW (R-4, R-5, R-6, R-7).
- **N2-F6 (new) Size-name spelling:** `20oz.`, `20oz`, `20 oz` are three
  rows. Lean: table keyed on the exact synced name; the settings screen lists
  every name used by an item with a recipe, and pre-fills (unsaved) a volume
  for names that contain a number + "oz", so the ADMIN confirms rather than
  types. No silent parsing at label time.

## RULING NOW

- **R-1 Reference amount.** Is the default 12 fl oz (prompt) or 8 fl oz
  (FDA's RACC for juices/shakes/milk drinks)? It is also the reference the
  (b)(6)/(b)(12) percentages are taken against. Lean: **12, as Gary said** —
  the regulation does not name smoothies and this label is voluntary format
  (B10); the setting is editable either way.
- **R-2 Per-serving math.** Per-serving = totals × serving ÷ volume (the
  unrounded ratio), while the label *prints* the rounded "about 2.5". Lean:
  yes — the prompt's "÷ servings per container" read as the unrounded ratio.
- **R-3 The single-serving rule (b)(6).** Under FDA, a 20 fl oz drink at a
  12 fl oz serving is **one 20 fl oz serving**, not 1.67 or "2". Follow
  (b)(6) (anything under 2× the serving size is one serving of the whole
  item, single column), or Gary's straight division? Lean: **follow (b)(6)**,
  using the chosen serving size as the reference amount.
- **R-4 %DV basis.** (d)(7)(ii) allows the declared (rounded) or actual
  amount. Lean: **declared amount**, so a reader can check the label's own
  arithmetic.
- **R-5 Vitamin/mineral amount rounding.** The (c)(8)(iv) significance
  column was not readable. Lean (UNCONFIRMED — from FDA's industry rounding
  table as remembered, not read): vitamin D nearest 0.1 mcg, calcium nearest
  10 mg, iron nearest 0.1 mg, potassium nearest 10 mg. Gary either accepts
  that or the build re-reads the table first.
- **R-6 "Less than" forms.** Lean: cholesterol 2–5 mg → "<5mg"; carb, fiber,
  sugars, added sugars, protein 0.5–<1 g → "<1g"; below the zero threshold →
  0. Fat at exactly 5 g → nearest gram (5 g).
- **R-7 %DV below 2 %.** Lean: print "0%" (allowed), no asterisk footnote.
- **R-8 mL conversion.** FDA uses 1 fl oz = 30 mL, so "12 fl oz (360 mL)",
  not the prompt's 355. Lean: 360.

## Comments (no ruling needed)

- Dev has no recipes; Phase 3's fixture is pure, the real-data check is
  staging (A).
- `FDA_DAILY_VALUES` (N-1c) matches 101.9(c)(9)/(c)(8)(iv) — reused, not
  duplicated (B8).
- Restaurant-law status (20+ locations; the (j)(2)(i) proviso) is a pre-N-3
  question for Gary/counsel (B10).
- `Recipe.servingSizeQty/Unit` is the sub-recipe default amount and stays
  untouched (A).

## Files read

`prisma/schema.prisma` (Organization, SalesItem, Recipe, RecipeLine,
Ingredient, IngredientNutrition, MenuItem*, LaborSettings),
`src/lib/recipe-nutrition.ts`, `src/lib/nutrition.ts`,
`src/lib/nutrition-access.ts`, `src/lib/nutrition-proof.ts`,
`src/lib/label-review.ts:180-215`, `src/lib/permissions.ts:174-175, 360-380`,
`src/app/(app)/nutrition/menu/page.tsx`,
`src/app/(app)/nutrition/menu/menu-nutrition-client.tsx` (detail dialog),
`src/app/api/nutrition/recipes/[id]/route.ts`,
`src/app/api/square/sales-items/sync/route.ts:96-116`,
`docs/PERMISSIONS_INVENTORY.md` (NV-18, PG-36/37, NU-1…8),
`docs/ROADMAP.yaml` (N-2 row).

Queries run (read-only, scratch scripts outside the repo, deleted after):
three `npx tsx --env-file=.env` scripts on `br-broad-wave-a6vpjdw0` (dev):
distinct variation names with recipe counts; menu group × variation names;
`Recipe` counts per org. No prisma CLI commands were run.
