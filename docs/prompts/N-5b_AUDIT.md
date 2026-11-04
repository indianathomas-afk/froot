# N-5b audit — count add-on (modifier) recipes in theoretical usage

TIER 3. Prompt of record: `docs/prompts/N-5b-modifier-usage.md`. Read-only
audit, 2026-11-04, on `staging` at `2d891ea` (origin/staging = 2d891ea,
origin/main = 6d2cb1f — measured with `git log`). No source file was edited.
Database reads in this audit are from **dev** (`br-broad-wave-a6vpjdw0`, branch
id read from the server via `current_setting('neon.branch_id', true)`) unless
stated otherwise. Production figures are quoted from DEPLOY_LOG with their
provenance and were NOT re-measured.

---

## 0. Preconditions

- Branch `staging`, HEAD `2d891ea`; main `6d2cb1f`. Matches the prompt.
- **Fixture count is 68, not 67** (`ls scripts/verify-*.ts | wc -l` → 68). The
  BUG-20 row already records "all 68 scripts/verify-*.ts green", so 67 in the
  prompt is the miscount. Run result: § 0a.
- ORDERS_READ held; no scope change needed or proposed.

### 0a. Fixture run at start

**68 / 68 PASS** on dev (`.env`), 2026-11-04, at `2d891ea` — each
`npx tsx scripts/verify-*.ts` run separately, exit code 0 for all 68, no FAIL
lines. Run in the background while this audit was written.

---

## 1. Facts from the N-5 audit — verified against the code

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | 595 modifiers synced; 127 modifier recipes imported | **NOT VERIFIABLE HERE — provenance is relayed evidence, not a measurement.** | DEPLOY_LOG `3ea8112` entry: "595 modifiers" from the Sync from Square result on staging and production (Gary, as relayed). "127" is the BevSpot **preview** count ("31 recipes ready + 127 modifier recipes (+6 prep)"); Gary applied **158** in total. 31 + 127 = 158, so "127 applied" is consistent but not measured. Dev has **0** `SquareModifier` rows and **0** modifier recipes (`br-broad-wave-a6vpjdw0`), so nothing can be checked on dev. Production SQL in § 9 for Gary. |
| 2 | Negative lines only on modifier recipes | **CONFIRMED in code.** | `src/lib/recipe-api.ts:75` refuses `amount < 0` unless the recipe is a modifier; `src/lib/bevspot/plan-import.ts:322` refuses `NEGATIVE_QTY` unless `allowNegative` (true only while resolving a modifier's own lines, :316). Dev holds 0 negative lines of either kind (`br-broad-wave-a6vpjdw0`). Production count: § 9 query B. |
| 3 | Modifier quantity is per unit of the line | **CONFIRMED from Square docs, as recorded by N-5.** | N-5_AUDIT § A2 item 6 quotes `OrderLineItemModifier.total_price_money`: "the modifier's base_price_money multiplied by the line item's quantity". Re-read this session (OrderReturnLineItemModifier page, same wording). |
| 4 | A removed default-on modifier arrives as quantity 0 | **CONFIRMED from Square docs, as recorded by N-5.** | "The modifier quantity can be 0 or more … If the buyer does not want any cheese, the modifier quantity is set to 0." Keva models removals as their own "No X" modifiers (BevSpot rows), which arrive with quantity ≥ 1 and carry negative lines. |
| 5 | New cache table written inside the BUG-7 guarded write | **CORRECT as a design requirement; nothing writes it yet.** | `writeSalesCache`, `src/lib/sales-sync.ts:144-251`. Placement in § 3. |
| 6 | Five consumers read theoretical usage | **CONFIRMED — five, listed in § 4.** The N-5 audit said "four readers" in its summary and "five consumers" in § C; the five are the four expected-inventory surfaces plus the variance report. Profitability is a sixth reader of `SalesLineCache` but reads recipe COST per item, not ingredient usage (§ 4, RULING R6). |

---

## 2. Where order line items are fetched; are modifiers captured?

`/Users/garythomas/Claude_Projects/Froot/froot/src/lib/sales-sync.ts`

- `syncSalesForStoreTimed` (:316-487) POSTs `/v2/orders/search` (:353), states
  OPEN + COMPLETED, `created_at` window, 500 per page, cursor loop.
- Orders without `tenders` are skipped (:393).
- Line aggregation (:437-444): `catalog_object_id` × `quantity` → `byLine`
  keyed `date|variationId`. **`line_items[].modifiers[]` is DROPPED.** The
  `SquareLineItem` type (:27-32) does not even declare it.
- Raw orders are never stored.
- **Every Square sales read goes through `syncSalesForStore`** — 21 call sites
  in 13 files (manual sync, dashboard summary/sales/rollup, forecasting
  backfill, webhook, nightly reconcile, and `ensureSalesCached`'s gap-fill used
  by every report and expected-inventory). Searched by both `syncSalesForStore(`
  and `ensureSalesCached(` (CLAUDE.md § Verifying a guard covers every path).
  One change in `syncSalesForStoreTimed` + `writeSalesCache` therefore covers
  all of them, webhook included.

---

## 3. The BUG-7 guarded write, and where the new write fits

`writeSalesCache` (`sales-sync.ts:144-251`), one transaction:

1. `INSERT … ON CONFLICT ("storeId","date") DO UPDATE … WHERE
   "SalesPeriodCache"."syncedAt" < EXCLUDED."syncedAt" RETURNING "date"`.
   `syncedAt` = the instant this sync began reading Square. A day is **won**
   only if this read is newer than the stored one; the row lock taken here
   serialises every later statement for that store-day.
2. For **won dates only**: `deleteMany` then `createMany` on
   `SalesHourlyCache` and `SalesLineCache`. Discarded days keep the winner's
   rows untouched.

**The new write goes in step 2, after the line rows, identical shape:**
`tx.salesModifierCache.deleteMany({ storeId, date: { in: wonDates } })` then
`createMany` of the rows whose date is in `writtenSet`. This is
**replace-per-store-day, never append**:

- Each sync re-reads the whole store-day, so the rows it writes are the
  complete truth for that day; delete-then-insert replaces them.
- A newer fetch (the 2nd and 3rd of a webhook burst) wins and replaces with
  the same totals; an older fetch that commits late loses the period upsert and
  writes nothing.
- The `@@unique([storeId, date, squareModifierId])` key makes an accidental
  append fail loudly (P2002) instead of doubling.

That is the same mechanism that keeps `SalesLineCache` from double counting
today under the 2026-11-04 bursts (2–3 syncs within 200 ms).

If R1-history needs the completeness flag (§ 8, R1b), the flag is one more
column in step 1's `INSERT … SET` list — set `true` by every post-N-5b writer.

---

## 4. The five consumers (all absolute paths)

Two computation sites feed five surfaces.

**Site A — `salesUsageForWindow`,
`/Users/garythomas/Claude_Projects/Froot/froot/src/lib/expected-inventory.ts:86-131`**,
CONSUMPTION mode. Reads `SalesLineCache`, maps variation → `SalesItem.recipe`,
expands, sums per ingredient, counts unmapped sold items.

1. **Expected on-hand** — `computeExpectedInventory` (:135) →
   `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/expected/route.ts`
2. **Weekly usage → pars** — `computeWeeklyUsage` (:286; sales basis only when
   no count periods exist, 28-day lookback) →
   `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/pars/route.ts`
   (shown as "Usage / wk" on the ingredients page)
3. **Low-stock alerts** — `computeLowStockAlerts` (:388, via expected) →
   `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/alerts/route.ts`
   and `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/alerts/count/route.ts`
4. **Order guide** — expected + weekly usage →
   `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/order-guide/route.ts`

**Site B — inline loop in the variance report**, THEORETICAL mode:

5. **Variance** —
   `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/reports/variance/route.ts:64-112`
   (adds manual `VarianceAdjustment` deltas per sales item; returns per-item
   `soldContributions` for the hover math).

**How each picks up modifier usage:** consumers 1-4 all come through
`salesUsageForWindow`, so one change there (read `SalesModifierCache` for the
window, map `squareModifierId` → `SquareModifier.recipe`, expand with the same
mode, add to `usage`, count unmapped) covers all four. Consumer 5 needs the
same addition in its own loop, plus modifier entries in `soldContributions`
(so the hover shows "Whey boost × 40"). Proposed: one shared helper in
`expected-inventory.ts` (or `recipe-cost.ts`) used by both sites, taking the
mode, so the two cannot drift.

**Not a usage consumer, reads `SalesLineCache`:**
- `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/reports/profitability/route.ts`
  — per-item recipe cost × qty sold. Modifier cost is missing from it today
  (an add-on's cost is unattributed). RULING R6.
- `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/inventory/reports/item-sales/route.ts`
  — sales only, no recipes. Unaffected.

---

## 5. Square modifier ID → Froot modifier recipe

Order JSON: `line_items[].modifiers[].catalog_object_id` = the Square
CatalogModifier id. Mapping:

`catalog_object_id` → `SquareModifier.squareModifierId` (unique per org,
`@@unique([organizationId, squareModifierId])`) → `SquareModifier.id` →
`Recipe.squareModifierId` (`@unique`, FK to `SquareModifier.id` — the Froot
cuid, NOT the Square id) → `Recipe`.

A modifier sold is one of:
- **mapped** — has a Recipe → expand;
- **NON_RECIPE** — `recipeStatus = 'NON_RECIPE'`, no recipe → skip silently
  (e.g. "Light ice");
- **unmapped** — no recipe, not NON_RECIPE → skip and **count**;
- **unknown** — id not in `SquareModifier` (catalog not synced since the
  modifier was created, or a TEXT-list modifier) → skip and count with unmapped.
- A modifier swept to `isDeleted` keeps its recipe (N-5 rule) and still counts
  for historical sales.

**How many of the 595 have a recipe:** cannot be measured on dev (0 rows on
`br-broad-wave-a6vpjdw0`). § 9 query A gives Gary the production split —
total / live / with recipe / NON_RECIPE / unmapped / on-by-default /
on-by-default-with-recipe — counts only.

---

## 6. Unit math, end to end

Per order line L with quantity `qL` (Square decimal string, may be
fractional) and modifier M with quantity `qM` (per unit of the line):

1. **Sync:** cache quantity for (store, date, M) += `qL × qM`. Absent `qM` →
   treat as `"1"` (the same default the line code uses for `qL`, :441).
   `qL × qM = 0` → contributes nothing; a row whose day total is 0 is not
   written.
2. **Read:** `expandRecipeToIngredients(graph, recipe(M), Σ(qL×qM), mode)`
   (`/Users/garythomas/Claude_Projects/Froot/froot/src/lib/recipe-cost.ts:337`)
   — linear and sign-preserving: each line contributes `amount → reporting unit
   × multiplier`; sub-recipes and (in theoretical mode) prepared ingredients
   expand recursively. **No clamp.**
3. Added to the same per-ingredient map as the item usage.

Worked examples:
- 2 smoothies, 1 Whey boost each, recipe "Whey 1 oz": cache 2 → whey +2 oz.
- Same line with "No Banana (add 2oz juice)" (Bananas −1.6 oz, juice +2 oz):
  cache 2 → bananas −3.2 oz, juice +4 oz. The smoothie's own recipe already
  added the bananas, so the net is right.
- Default-on modifier removed by the buyer: `qM = 0` → 0 → nothing. Correct
  only if that modifier's recipe is NOT already inside the item recipe —
  see R5.
- Extra ×2 of a modifier: `qM = 2` → `2 × qL`.
- A recipe expansion failure (loop / unit) → listed in `expansionProblems`,
  never treated as zero (existing contract).

Day-level totals can be negative for an ingredient only if removals outsell
the items that contain it — possible only on mapping mistakes; shown with its
sign, as N-5 ruled for cost.

---

## 7. Backfill cost (R1)

Measured on dev `br-broad-wave-a6vpjdw0` (`SalesPeriodCache`, a fork of
production holding data through 2026-08-13; 9 linked active stores): the four
long-history stores average **121–147 orders/store-day, max 550**; others
33–141.

Square cost of a re-sync = one `/v2/orders/search` per 500 orders in the
window (the sync is already full-day, so a backfill IS just a re-sync).

| Window | Calls per store (≈140 orders/day) | 9 stores |
|---|---|---|
| 1 day | 1 | 9 |
| 28 days (weekly-usage lookback) | ≈ 8 | ≈ 72 |
| 90 days | ≈ 25 | ≈ 225 |
| full history (~573 days) | ≈ 160 | ≈ 1,000+ (fewer on short-history stores) |

Payload size per page was not measured. Each re-synced day also rewrites its
period/hourly/line rows with the same values (BUG-7-guarded, safe alongside
live syncs). **No new code is needed to backfill:** the existing
`POST /api/square/sales/sync` (start/end) or the forecasting force re-sync
(14-day chunks, `forecasting/backfill/route.ts`) would refill modifier rows
once N-5b ships. The 03:00 reconcile cron already re-reads the last 3 days.

Production counts are not known here; § 9 query C gives them.

---

## 8. Returns — what the sync does today

- The search filters OPEN + COMPLETED and **then requires `tenders`** (:393).
  A refund is recorded by Square as a return on an order (`returns[]` with
  `return_line_items[]`, each with `return_modifiers[]`). The sync reads
  `line_items` only and **never reads `returns`**, on any order.
- So today **no refund reaches `SalesLineCache`**, and therefore none reaches
  usage. Whether a return-only order has tenders (and so whether its
  `total_money` reaches the sales totals) is **UNVERIFIED** — Square's Order,
  OrderReturnLineItem and refunds-guide pages did not render for this session;
  only OrderReturn / OrderReturnLineItemModifier were readable (see report).
- The reconcile cron's header (`src/app/api/cron/sales-reconcile/route.ts:8-9`)
  says the nightly re-pull is "absorbing late refunds". **Nothing in the sync
  reads refund data**, so that comment is at best partly true (it would absorb
  an edited order's new totals). Finding F3.

---

## 9. Production SQL for Gary (read-only, Neon console, production branch)

Branch identity comes from the server (R4); no literal.

```sql
-- A. modifier mapping split, per org
SELECT current_setting('neon.branch_id', true) AS branch_id,
       m."organizationId",
       count(*)                                                     AS total,
       count(*) FILTER (WHERE NOT m."isDeleted")                    AS live,
       count(r.id)                                                  AS with_recipe,
       count(*) FILTER (WHERE r.id IS NULL AND m."recipeStatus" = 'NON_RECIPE')  AS non_recipe,
       count(*) FILTER (WHERE r.id IS NULL AND m."recipeStatus" <> 'NON_RECIPE') AS unmapped,
       count(*) FILTER (WHERE m."onByDefault")                      AS on_by_default,
       count(r.id) FILTER (WHERE m."onByDefault")                   AS on_by_default_with_recipe
FROM "SquareModifier" m
LEFT JOIN "Recipe" r ON r."squareModifierId" = m.id
GROUP BY m."organizationId";

-- B. negative lines by recipe kind
SELECT current_setting('neon.branch_id', true) AS branch_id,
       (r."squareModifierId" IS NOT NULL) AS is_modifier_recipe,
       count(DISTINCT r.id) AS recipes, count(*) AS negative_lines
FROM "RecipeLine" l JOIN "Recipe" r ON r.id = l."recipeId"
WHERE l.amount < 0
GROUP BY 2;

-- C. backfill volume: orders per store-day, last 90 days
SELECT current_setting('neon.branch_id', true) AS branch_id,
       "storeId", count(*) AS days, round(avg("orderCount")) AS avg_orders,
       max("orderCount") AS max_orders, sum("orderCount") AS total_orders
FROM "SalesPeriodCache"
WHERE date >= current_date - 90
GROUP BY "storeId" ORDER BY total_orders DESC;
```

---

## 10. Proposed schema (additive only)

```prisma
// N-5b: Square order-line modifiers per store-day. quantity = Σ (line qty ×
// modifier qty). Raw Square fact — mapping to a recipe happens at read time,
// like SalesLineCache. Written ONLY inside writeSalesCache's BUG-7 guarded
// transaction, delete-then-insert for won dates: replaced per store-day on
// every sync, never appended.
model SalesModifierCache {
  id               String   @id @default(cuid())
  organizationId   String
  storeId          String
  date             DateTime @db.Date
  squareModifierId String
  quantity         Float    @default(0)

  organization Organization @relation(fields: [organizationId], references: [id])
  store        Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, date, squareModifierId])
  @@index([storeId, date])
}
```

Unique key `(storeId, date, squareModifierId)` — one row per modifier per
store-day; with delete-then-insert under the period-row lock, a repeat sync
replaces, and any code path that tried to append would hit P2002.

Conditional on R1b: `SalesPeriodCache.modifiersCaptured Boolean
@default(false)` — set true by every N-5b sync in the guarded upsert. Existing
rows read false, so a consumer can tell "no modifiers sold" (true, no rows)
from "day cached before N-5b" (false) and flag reduced confidence instead of
undercounting silently — the promise in expected-inventory's header (:24-26).

If R2 = subtract returns: either a signed `quantity` (returns negative) in the
same row, or a separate `returnedQuantity Float @default(0)` column. Lean:
separate column, so sales and returns stay separately inspectable.

---

## 11. Rulings needed (STOP)

- **S — Speed follow-up from the 11-04 production logs.** BUG-20 and BUG-21
  are `status: planned` (ROADMAP.yaml :26028, :26147). BUG-22 is free (no hit
  in docs/ or src/). Needed from Gary: the 11-04 production timing lines (this
  session does not have them), whether to file BUG-22 (webhook burst /
  full-day re-read), and whether to stamp `6d2cb1f`'s DEPLOY_LOG entry with
  them in this session's docs commit.
- **R1 — History.** Forward only, or backfill (cost § 7)?
  - **R1b (follows from R1):** with forward-only, a window spanning ship day
    silently undercounts. Lean: add `SalesPeriodCache.modifiersCaptured` and
    surface "N days without modifier data" beside the existing
    `missingSalesDays` flag. With backfill, the flag still guards any day not
    re-synced.
- **R2 — Refunds.** Count sales only and note refunds as a gap (matches what
  item usage does today), or subtract returns now? Lean: sales only + gap row —
  return semantics are unverified (§ 8), and item usage does not subtract
  returns either, so subtracting for modifiers alone would make the two
  inconsistent.
- **R3 — Unmapped modifiers.** Lean: skip and show a count (distinct unmapped
  modifiers sold in the window), beside `unmappedSoldCount`; NON_RECIPE
  skipped silently.
- **R4 — Absent modifier quantity.** Lean: treat as 1, same as the line.
- **R5 — Default-on modifiers with a recipe.** A default-on modifier arrives
  qty 1 on every sale where it is not removed. If its ingredients are also in
  the item recipe, usage doubles. Lean: count it like any other modifier (the
  recipe is what Gary imported; quantity 0 removal is then correct), and show
  the on-by-default-with-recipe count from query A so it is checked once.
- **R6 — Profitability.** Add modifier cost to the profitability report now,
  or leave it (usage only) and file a row? Lean: leave it; N-5b is usage.
- **R7 — Variance hover.** Show modifier contributions in the variance hover
  ("Whey boost × 40")? Lean: yes — otherwise an ingredient's theoretical
  number cannot be explained from the hover.

---

## 12. Out-of-scope findings, triaged

| # | Finding | Class |
|---|---|---|
| F1 | Prompt says 67 fixtures; there are 68 (BUG-20 row already says 68). | COMMENT (report) |
| F2 | N-5 audit summary says "four readers", § C says "five consumers". Reconciled in § 4. | COMMENT (report) |
| F3 | `cron/sales-reconcile/route.ts:8-9` says it absorbs late refunds; the sync never reads refund data. | RULING NOW (folds into R2: the gap row would carry it) |
| F4 | Profitability omits modifier cost. | RULING NOW (R6) |
| F5 | `VarianceAdjustment` manual deltas exist per sales item only, not per modifier. | COMMENT (no one has asked for modifier deltas) |
| F6 | 595 / 127 are relayed figures and cannot be measured on dev. | RULING NOW (§ 9 query A for Gary) |

No ROW is proposed by the audit itself; R2's gap row is Gary's to rule.
