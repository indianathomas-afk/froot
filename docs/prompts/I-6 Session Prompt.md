# Phase I-6 — Session-starter prompt (test)

Paste the entire fenced block below as the first message of a fresh Claude Code session linked to the Froot folder.

```
Continue in the Froot repo (froot/). Work on the staging branch per WORKFLOW.md —
never commit to main directly.

STEP 0 — HOUSEKEEPING (do this first, before any I-6 work):
There are two uncommitted doc changes: a new ROADMAP.md and an updated CLAUDE.md
Phase Status section. Review them, then commit them alone:
  git add ROADMAP.md CLAUDE.md && git commit -m "docs: add ROADMAP.md as single source of truth for phase status"
From now on, ROADMAP.md is where phase status lives.

STEP 1 — ORIENT:
requireModule("inventory"). Read src/lib/units.ts, the Phase I-1 code (SalesItem,
Ingredient), and the I-5 code (SalesLineCache, inventory-period math) before
writing anything. Then present a short implementation plan for my approval before
touching the schema.

GOAL: Recipes link each sellable Square variation to ingredient quantities →
theoretical cost per menu item, plus the triage queue for unmapped sales items.
Also: inventory adjustments (waste/transfer/comp), prepared/batch items, and the
Variance + Profitability report tabs.

SCHEMA:
- Recipe: id, organizationId, name, salesItemId FK? @unique (the variation this
  recipe costs; null = sub-recipe/batch like "Cup Kit - 32oz"), yieldQty Float
  @default(1), yieldUnit String @default("serving"), servingSizeQty Float?,
  servingSizeUnit String? (the smallest quantity typically used when this recipe
  is a line inside another recipe — pre-fills the amount field in the editor),
  isActive, updatedAt
- RecipeLine: id, recipeId FK cascade, ingredientId FK?, subRecipeId FK? (exactly
  one set — enforce in Zod), amount Float, unit String (a usage unit: "fl. oz",
  "oz (dry)", "each", "serving"...)
- SalesItem: add recipeStatus String @default("UNMAPPED")
  // UNMAPPED | MAPPED | NON_RECIPE (modifier junk, $0 rows, one-off POS buttons)
- InventoryAdjustment: id, organizationId, storeId, ingredientId FK, ingredientName,
  type ("WASTE"|"TRANSFER_IN"|"TRANSFER_OUT"|"COMP"|"CORRECTION"|"PREP_CONSUME"|
  "PREP_PRODUCE"), quantity Float (reporting units), costPerReportingUnit Float,
  value Float, reason String?, createdByUserId, createdAt

HARD RULE (from how BevSpot avoids data corruption): recipes NEVER create, modify,
or write to Square catalog IDs. SalesItem Square fields stay read-only everywhere
in this phase; a recipe attaches to a variation via salesItemId only.

COST ENGINE (src/lib/recipe-cost.ts):
- recipeCost(recipeId): Σ lines — ingredient lines convert line.unit →
  ingredient.reportingUnit via src/lib/units.ts and multiply by
  costPerReportingUnit; sub-recipe lines recurse (cost / yieldQty × amount).
- LOOP DETECTION: a looped recipe is one whose sub-recipe chain circles back to
  itself (A → B → C → A). Detect cycles on every save AND in the cost engine.
  Reject the save with a named error listing the full chain ("A loop was detected:
  Cup Kit → Prep Mix → Cup Kit — remove one of these references to fix it") and
  link to the recipes involved. A looped recipe that slips through shows cost N/A,
  never $0.
- COST PROPAGATION: editing a sub-recipe's lines (or an ingredient's cost changing
  via PO receipt) must update the computed cost of every recipe and sales item
  that uses it, at any depth. Compute at read time (don't store stale costs) or
  invalidate a cache — your call, but state the choice in the plan.
- Dimension-mismatch (fl. oz of a lbs-based ingredient) → validation error
  surfaced in the UI, never silent 0.
- costPct(salesItem) = recipeCost / (priceCents/100); null when price is 0/absent.

API:
- CRUD /api/inventory/recipes with nested lines (manager/admin). GET includes
  computed cost, per-line cost, and margin.
- PATCH /api/inventory/sales-items/[id]: set recipeStatus (mark NON_RECIPE),
  attach recipe. POST /api/inventory/recipes/[id]/duplicate {salesItemId} — copy
  a recipe to another variation (build L once, duplicate to M/S/Kids, tweak).
- CRUD /api/inventory/adjustments (store-scoped; STAFF can log waste; manager+
  for corrections; transfers create paired IN/OUT rows across two stores).

TRANSFERS (multi-store movement must be first-class, or usage lies at both
stores — transfers OUT reduce the sender's stock without counting as its
usage-by-sales, transfers IN add to the receiver's):
- A transfer is ONE record with a header (fromStoreId, toStoreId?, occurredAt
  date-time — backdatable so it lands in the right inventory period, note) and
  MULTIPLE lines (ingredient, qty, unit convertible to the ingredient's
  dimension). Saving writes paired TRANSFER_OUT/TRANSFER_IN InventoryAdjustment
  rows sharing a transferGroupId. Because ingredients are org-level (I-3 core
  rule), no item mapping between stores is ever needed.
- Custom destination: toStoreId null + destinationLabel String ("Kitchen",
  "Catering — Smith wedding") = outbound-only transfer to a named non-tracked
  destination; writes TRANSFER_OUT rows only. Previously used labels suggested.
- Transfer log view: grouped by transferGroupId (header + lines), filterable by
  store/date/destination; each finalized inventory period shows its transfers
  in/out totals in the I-5 period detail.

LOSS:
- LossReason: id, organizationId, label, isDefault — seed Spoilage, Breakage,
  Comp, Theft/Unknown; org can add custom reasons. InventoryAdjustment gets
  lossReasonId FK? (WASTE/COMP rows).
- Loss entry mirrors transfers: one record, multiple lines, backdatable
  date-time, reason + note; quick-log stays one-tap simple for a single spoiled
  item.
- Loss report: $ by reason and by ingredient category over a date range.
- Extend I-5 usage math: usage = beginning + purchases − ending − transfersOut
  + transfersIn; report waste $ separately. Theoretical usage per ingredient =
  Σ (SalesLineCache.quantitySold × recipe amounts, sub-recipes expanded);
  variance report = actual usage − theoretical usage, biggest $ gaps first.

PREPARED / BATCH ITEMS (prep that gets counted like inventory):
- A sub-recipe (Recipe with salesItemId null) can be marked "countable": this
  creates a linked Ingredient of kind PREPARED (preparedFromRecipeId String? on
  Ingredient), reporting unit = the recipe's yieldUnit, cost per reporting unit =
  recipe cost / yieldQty (recomputed when ingredient costs change).
- "Record prep" action (any assigned store user): pick a countable recipe, a
  batch multiplier (½ / 2× / custom), store, date, notes → writes paired
  InventoryAdjustment rows: PREP_CONSUME (negative, one per ingredient line,
  quantities × multiplier) and PREP_PRODUCE (positive on the prepared ingredient,
  yieldQty × multiplier). Fold both into the I-5/I-7 usage and on-hand math.
- Prepared ingredients are countable in storage areas (I-3/I-4 pickers include
  them) and usable as recipe lines like any other ingredient.
- Prep history visible in the adjustments log filtered to prep types, with a
  "re-record" shortcut that pre-fills the last batch.

UI:
- inventory/recipes/page.tsx: sales items grouped by menu group (mirroring how
  operators think), columns: displayName, price, recipe cost, cost %, status
  badge; filter "Needs attention" (UNMAPPED with price > 0 first); bulk "mark
  non-recipe"; a separate "Prep recipes" tab for countable sub-recipes with a
  Record Prep button.
- inventory/recipes/[id]/page.tsx: recipe editor — ingredient/sub-recipe
  typeahead, amount + unit inputs (unit dropdown limited to units convertible to
  the ingredient's dimension; sub-recipe lines pre-fill from servingSize), live
  per-line cost + total + cost % as you type, duplicate-to-variation button.
  Editing a sub-recipe shows "used in N recipes" with links, and saving surfaces
  a toast: "Costs updated for N recipes."
- inventory/adjustments/page.tsx: quick-log form (store, ingredient typeahead,
  type, qty, reason) + filterable history.
- EXTEND THE I-5 REPORTS SUITE (inventory/reports) with two tabs:
  7. VARIANCE — per ingredient: amount used (usage equation) vs. amount sold
     (Σ mapped sales × recipe amounts, sub-recipes expanded), variance qty + $,
     biggest $ gaps first; group by category / vendor / all items; hover on Used
     and Sold shows the math. Cause hints: negative variance (used > sold) →
     over-portioning, unrecorded loss/comps, missing delivery, mapping mistake;
     positive (sold > used) → miscount, negative usage, mapping mistake. Only
     ingredients present on boundary counts or mapped to something sold appear.
     Manual per-item sold-quantity adjustment lives here only (VarianceAdjustment:
     storeId, salesItemId, periodKey, qtyDelta, note) — Square data stays
     untouched.
  8. PROFITABILITY — per sales item over the period: qty sold, gross sales,
     recipe cost, cost %, gross profit $; sortable; menu-group rollup; UNMAPPED
     items surface with a "map it" link into the recipes triage queue.

ACCEPTANCE:
- Rebuild All That Razz (L) from the Keva export (2.3 fl. oz juice @ $0.2241/fl.
  oz → $0.52; 8 fl. oz sherbet; 2.32 oz dry bananas; 6 oz dry strawberries;
  1 serving Cup Kit sub-recipe) → total ≈ $2.14 and cost % ≈ 25.2% at $8.49.
  Include this as a seed/test fixture.
- Attempting to save a recipe loop (A → B → C → A) is rejected with the named
  chain error; a looped recipe shows cost N/A rather than $0.
- Editing the Cup Kit sub-recipe changes the computed cost of every sales item
  using it (test at 2+ levels of nesting).
- Recording a prep batch decrements ingredient on-hand estimates, increments the
  prepared item, and the prepared item is countable in a draft.
- A 3-line transfer between two stores writes 6 adjustment rows sharing one
  transferGroupId; a "Kitchen" custom transfer writes OUT rows only; both land
  in the inventory period matching their backdated occurredAt.
- Received PO price change updates recipe costs.
- No Square catalog write occurs anywhere in this phase (grep the diff for
  Square mutation calls to confirm).
- lint + build pass.

WHEN DONE:
1. Update ROADMAP.md: mark I-6 ✅ Done with today's date, the commit hash, and a
   one-line summary. Commit it with the phase code.
2. Summarize what was built, what was deferred, and anything I-7 (reorder points)
   should know.
```
