# Froot — Inventory Management & Nutritional Data: Claude Code Prompt Pack

**v2.3 — revised 2026-07-06.** v2.3 rewrites Phase I-5 as a full reporting suite under the Inventory menu (inventory periods as the default reporting window, Summary / Item Sales / COGS / Valuation / Turnover / Vendor Spend tabs, hourly sales cache), adds Phase D-1 (Store Dashboard redesign from froot_docs/dashboard-design/, monthly goals + extrapolation, mock-backed boxes for messages/corporate/checklist/Instagram), and extends I-6's report suite with Variance and Profitability tabs.

**v2.2 — revised 2026-07-06.** v2 established the domain model (sales items vs. ingredients) from Keva's operational exports. v2.1 expanded Phase I-3 (storage areas: bulk assignment, unassigned triage, multi-store copy) and amended I-4 (weighing, offline-tolerant counting, post-finalize corrections), I-5 (negative-usage flags), and I-6 (multi-line transfers with custom destinations, loss reasons) from standard count-workflow practice. v2.2 expands I-4's UI into an inventory overview + history timeline (sitting-inventory header, one-draft-per-store, event-shaped history rows that I-6 extends).

Phased build prompts for the two add-on modules. Run each phase as a separate Claude Code session against the `froot/` repo, in order. Each prompt is self-contained — paste the whole fenced block.

---

## THE DOMAIN MODEL — read this before any phase

This is the core workflow logic the whole module is built around. Getting this wrong makes counts and costing meaningless.

**There are two different kinds of "items," and they must never be conflated:**

### 1. Sales items (come FROM Square — sellable, never counted)
What the store sells: "All That Razz (L)". Synced from the Square catalog. **Each Square item *variation* is its own sales item** — All That Razz (Kids), (S), (M), (L) are four sales items with four POS IDs, four prices, four recipes, and four cost percentages. Sales items are never counted in inventory and never purchased from vendors.

### 2. Ingredients (created IN Froot — purchasable, countable, never sold directly)
What the store buys and counts: "Patagonia Foods Strawberries Frozen IQF," "Bananas," "Boba straws." **Not imported from Square** — added manually (or via CSV import) because Square knows nothing about them. Each ingredient has:

- Brand + name (brand optional: "Bananas")
- **Purchase unit** with pack size: "box (40 lbs)" @ $32.85/box, "case (2 × 36 fl. oz bottle)" @ $19.23
- **Reporting unit** (lbs, fl. oz, each) — the unit costs are normalized to: $32.85 ÷ 40 = $0.82/lb
- **Ingredient category** carrying a **GL code** (Juices → 5015, Produce → 5510, Cups/Lids/Straws → 5035) — these are accounting categories, completely separate from Square's menu categories
- One or more **vendors** with per-vendor pack sizes and prices ("Multiple Vendors" is normal)

### 3. Recipes (the bridge between the two)
A recipe belongs to **one sales item variation** and lists ingredient amounts in **usage units**: All That Razz (L) = 2.3 fl. oz raspberry juice + 8 fl. oz orange sherbet + 2.32 oz (dry) bananas + 6 oz (dry) frozen strawberries + 1 serving "Cup Kit - 32oz."

- **Unit conversion is the engine**: bananas are bought per 40-lb box ($0.82/lb) but used in oz (dry) → $0.82 ÷ 16 = $0.0513/oz → 2.32 oz costs $0.12. Volume: gal → 128 fl. oz, etc.
- **Sub-recipes**: "Cup Kit - 32oz" is itself a recipe (cup + lid + straw + ...) with a yield in servings, used as a line inside other recipes at $0.34/serving.
- **Cost % = recipe cost ÷ sales price** (All That Razz (L): $2.14 ÷ $8.49 = 25.2%).
- Sales items **without** a recipe show cost N/A and appear in a "needs attention" queue. A real Square catalog has hundreds of these (modifier junk like "1/2 Black Peaches", $0 items) — the workflow must make triaging them easy (map to recipe / mark as non-recipe / ignore).

### The complete workflow loop
1. **Sync** sales items (with variations, prices, menu groups) from Square — read-only.
2. **Create ingredients** in Froot with categories/GL codes, vendors, pack sizes, costs.
3. **Build recipes** linking each sellable variation to ingredient quantities → theoretical cost % per menu item.
4. **Operate**: storage areas, physical counts, purchase orders, waste — all on *ingredients*.
5. **Report**: sitting inventory $, usage $ (counts + purchases), actual vs. theoretical cost %, COGS by GL category, variance.

Nutrition attaches to **sales items** (what customers see), inventory attaches to **ingredients** — same Square sync, two clean layers.

---

## What already exists in the repo (do not rebuild)

- **Schema scaffolding** in `prisma/schema.prisma`: `StorageArea`, `ItemStorageMapping`, `ItemMetadata`, `InventoryCount`, `InventoryCountLine`, `MenuItem`, `MenuItemNutrition`, `MenuItemAllergen`. NOTE: the Phase I-1 prompt below *replaces* the Square-object-keyed approach of `ItemMetadata` with a proper `Ingredient` entity; `ItemStorageMapping`/`InventoryCountLine` get re-pointed to ingredients.
- **Module gating**: `Organization.activeModules: String[]` + `requireModule("inventory" | "nutrition")` in `src/lib/auth.ts`
- **Billing UI**: Settings → Billing lists both add-ons (module keys `"inventory"`, `"nutrition"`)
- **Square OAuth**: per-org tokens on `Organization`, routes under `src/app/api/square/`
- **Store scoping**: `getUserStoreScope()` — never trust URL params for store access

## Conventions every prompt assumes (from CLAUDE.md and existing routes)

- Every API route: resolve org via `auth()` → `prisma.organization.findUnique({ where: { clerkOrgId } })`, 401/404 early returns, Zod body validation, `requireAdmin()`/`requireManagerOrAdmin()` for mutations
- Store-scoped data filtered by `getUserStoreScope()` unless admin
- UI: shadcn/ui + Radix + Lucide, Tailwind 4 CSS variables, pages under `src/app/(app)/`
- Square calls reuse the org's stored `squareAccessToken` and respect `SQUARE_ENVIRONMENT` (see `api/square/callback/route.ts`)
- Gate every module route with `requireModule(...)`; hide nav links when the module isn't active

---

# INVENTORY MODULE

## Phase I-1 — Square sales item sync + Ingredient library

```
You are working in the Froot repo (Next.js 16 App Router, Prisma 7 + Neon, Clerk
multi-tenant). Read CLAUDE.md and src/lib/auth.ts first and follow the conventions
exactly (org scoping via clerkOrgId, Zod validation, requireAdmin for mutations,
requireModule("inventory") for everything in this phase).

CRITICAL DOMAIN RULE: there are two distinct entities.
- SALES ITEMS come from Square (sellable; one per Square item VARIATION; never counted).
- INGREDIENTS are created in Froot (purchasable/countable; NOT in Square; what counts,
  purchase orders, and storage areas operate on).
Do not key inventory data to Square catalog object ids.

SCHEMA (add to prisma/schema.prisma, then `npx prisma migrate dev`):

Sales side (read-only mirror of Square):
- SquareCategory: id, organizationId, squareCategoryId, name, isDeleted Boolean
  @default(false) — @@unique([organizationId, squareCategoryId])
- SalesItem: id, organizationId, squareItemId, squareVariationId, name (item name),
  variationName ("L", "Kids", "Regular"), displayName (computed "All That Razz (L)"),
  squareCategoryId String?, menuGroup String? (category name denormalized),
  priceCents Int?, isDeleted Boolean @default(false), updatedAt
  — @@unique([organizationId, squareVariationId])

Inventory side (Froot-native):
- IngredientCategory: id, organizationId, name, glCode String?, sortOrder Int @default(0)
  — @@unique([organizationId, name])
- Ingredient: id, organizationId, brand String?, name, categoryId FK?,
  purchaseUnitLabel String ("box", "case", "bag"), packDescription String? ("2 x 36 fl. oz"),
  purchaseCost Float (cost per purchase unit),
  reportingUnit String ("lbs" | "oz (dry)" | "fl. oz" | "gal" | "each" | "serving" | ...),
  unitsPerPurchase Float (reporting units per purchase unit, e.g. 40 for a 40-lb box),
  costPerReportingUnit Float (derived: purchaseCost / unitsPerPurchase — persist it,
  recompute on any cost change), isActive Boolean @default(true), notes String?,
  createdAt, updatedAt
- Deprecate ItemMetadata: leave the table but stop referencing it in new code.
- Re-point ItemStorageMapping and InventoryCountLine in a later phase (leave them for now).

UNIT SYSTEM (src/lib/units.ts):
- Canonical units + conversion table: weight (lbs ↔ oz (dry): ×16), volume
  (gal ↔ fl. oz: ×128, L ↔ fl. oz: ×33.814, qt: ×32, pt: ×16, cup: ×8),
  count (each, serving — no cross-conversion).
- convert(amount, fromUnit, toUnit) → number | null (null when dimensions differ);
  costPerUnit(ingredient, unit) using the conversion. Unit dimension mismatch must be
  a visible validation error, never a silent 0.

SQUARE SYNC:
- src/lib/square.ts: getSquareClient(org) returning baseUrl + auth header from
  org.squareAccessToken and SQUARE_ENVIRONMENT (mirror api/square/callback/route.ts).
  Token refresh: if squareTokenExpiresAt within 7 days, refresh and persist.
- POST /api/square/sales-items/sync (admin): page ListCatalog (types=ITEM,CATEGORY,
  cursor pagination); upsert SquareCategory; for each item, upsert ONE SalesItem PER
  VARIATION (price from the variation's price_money); mark missing rows isDeleted.
  Store lastCatalogSyncAt on Organization. Return {categories, salesItems} counts.

INGREDIENT LIBRARY UI:
- src/app/(app)/inventory/ingredients/page.tsx: table (brand+name, category, GL code,
  pack ("box (40 lbs)"), purchase cost, cost per reporting unit), search, category
  filter, active toggle. Create/edit dialog with live "cost per reporting unit" preview
  as pack fields change. Category manager (create categories inline with GL code).
- CSV import (admin): upload a CSV with columns brand,name,category,glCode,
  purchaseUnitLabel,packDescription,purchaseCost,reportingUnit,unitsPerPurchase —
  preview table with per-row validation errors before committing. Use papaparse
  (already a dependency).
- src/app/(app)/inventory/sales-items/page.tsx: read-only synced sales items list
  (displayName, menu group, price, POS id), search + menu-group filter, "Sync from
  Square" button (admin) with result toast. Banner: "Sales items are sellable products
  synced from Square. Ingredients are what you count and order — manage them in
  Ingredients."
- Sidebar: "Inventory" section with Ingredients and Sales Items links, only when
  "inventory" is in the org's activeModules.

API:
- CRUD /api/inventory/ingredients (+ [id]), /api/inventory/ingredient-categories.
- GET list endpoints support q/category/isActive filters.

ACCEPTANCE:
- Square sandbox sync creates one SalesItem per variation; re-sync is idempotent.
- Creating "Bananas, box (40 lbs), $32.85, reporting unit lbs" shows $0.82/lb.
- CSV import round-trips a 50-row file with 2 bad rows reported and skipped.
- Org without the module gets MODULE_NOT_ACTIVE on all new routes.
- npm run lint and npm run build pass.
```

## Phase I-1b — Ingredient library: field parity, lifecycle & duplicate control

```
Continue in the Froot repo. Read CLAUDE.md, src/lib/auth.ts, and the Phase I-1 code
(Ingredient, IngredientCategory, the Ingredients and Sales Items pages).
requireModule("inventory") everywhere.

GOAL: Bring the Ingredient library to operational parity with the operator's
established workflow: full field set, bulk editing, archive/delete lifecycle,
duplicate control, and a clean price-vs-cost separation.

SCHEMA (Ingredient additions):
- subcategory String? (free text; often used for supplier grouping)
- sku String?
- glCodeOverride String?  // effective GL = glCodeOverride ?? category.glCode
- productNote String?     // supports URLs (reorder links) — render clickable
- isArchived Boolean @default(false)
- deletedAt DateTime?     // soft delete; no hard delete anywhere
- lastEditedByUserId String? — set on every mutation; display "date + person" in UI
- kind String @default("PURCHASED") // PURCHASED | PREPARED (PREPARED used in I-6)
New model:
- IngredientCostLog: id, ingredientId FK, costPerReportingUnit Float,
  source ("PO_RECEIPT"|"MANUAL"|"IMPORT"), sourceRef String?, createdAt
  — append a row on EVERY cost change. This is the cost history that keeps
  reporting explainable when prices fluctuate.

PRICE VS COST (make this distinction explicit in code and UI copy):
- PRICE = what a specific vendor charges per pack (VendorIngredient rows; one per
  vendor+SKU). Used for building/estimating purchase orders only.
- COST = the single costPerReportingUnit on the Ingredient, used by ALL reporting
  (count valuation, recipe costing, COGS). Updated most-recent-cost on PO receipt
  (log to IngredientCostLog; the receive response lists which costs changed so the
  UI can toast "3 item costs updated") or edited manually on the item card.
- Counts already snapshot cost per line (Phase I-4) — that plus the log preserves
  consistent historical valuation when prices move.

GL CODE BEHAVIOR (matches how categories drive accounting):
- Assigning a category gives the item its GL code automatically (inheritance).
- Editing a category's GL code shows a confirm dialog: "this updates the effective
  GL code for all N items in this category."
- Item-level glCodeOverride available on the item card for exceptions.
- COGS reporting (I-5) groups by effective GL code.

BULK EDIT:
- Items list: checkbox multi-select → Bulk Edit panel for Category, Subcategory,
  GL Code override, and default Vendor; new categories/vendors can be created
  inline from the panel. Also bulk Archive / Unarchive / Delete.

LIFECYCLE:
- Archive (seasonal/inactive): hidden from count drafts, storage-area pickers, and
  PO typeaheads; still searchable on the Items page via an Active | Archived | All
  toggle; Unarchive restores.
- Delete: soft (deletedAt), excluded everywhere; a "View deleted" screen offers
  Restore. No hard deletes.
- Creating an ingredient whose normalized name closely matches an archived or
  deleted one warns: "a version of this item already exists — restore it instead?"

DUPLICATE FINDER:
- GET /api/inventory/ingredients/duplicates: candidate pairs by normalized-name
  similarity (case/whitespace/punctuation-insensitive; trigram or Levenshtein) or
  identical non-empty SKU.
- UI page: pair list with Merge (pick the survivor; re-point VendorIngredient,
  storage mappings, and future references; warn that merging is safest before
  historical data accumulates) and Dismiss (persist dismissed pairs so they don't
  reappear). Same-name different-pack rows (e.g. two "Boba straws" bag sizes) are
  the classic dismiss case — never auto-merge.

LIST UX:
- Group-by dropdown: Category | Subcategory | Vendor | Last edited.
- Columns: Brand, Name, Category (+ effective GL), pack, vendor price, cost per
  reporting unit, last edited (date + person). Product-note icon with popover,
  URLs clickable.
- Extend the Phase I-1 CSV import with subcategory, sku, glCode, productNote columns.

ACCEPTANCE:
- Bulk-edit 10 items' category in one action; archived items disappear from a new
  count draft but stay searchable; duplicate finder flags two same-name items and
  Dismiss persists; every cost change writes an IngredientCostLog row.
- lint + build pass.
```

## Phase I-2 — Vendors, Purchase Orders & Receiving

```
Continue in the Froot repo. Read CLAUDE.md, src/lib/auth.ts, and Phase I-1 code
(src/lib/square.ts, src/lib/units.ts, ingredient models). requireModule("inventory").

GOAL: Vendor records, a purchase order lifecycle (draft → submitted → received), and
receiving — POs are for INGREDIENTS (never sales items).

SCHEMA:
- Vendor: id, organizationId, name, accountNumber, contactName, email, phone, terms,
  leadTimeDays Int?, notes, isActive Boolean @default(true), createdAt
- VendorIngredient: id, vendorId FK, ingredientId FK, vendorSku String?,
  packDescription String?, casePrice Float?, unitsPerCase Float? —
  @@unique([vendorId, ingredientId]). Multiple rows per ingredient across vendors =
  the price-comparison data ("Multiple Vendors" is a normal state).
- PurchaseOrder: id, organizationId, storeId FK, vendorId FK, poNumber (per-org
  sequence "PO-00042"), invoiceNumber String?, orderedAt DateTime?, expectedAt DateTime?,
  totalAmount Float, status String @default("DRAFT")
  // DRAFT | SUBMITTED | PARTIALLY_RECEIVED | RECEIVED | CANCELLED
  , enteredByUserId, createdAt
- PurchaseOrderLine: id, purchaseOrderId FK cascade, ingredientId FK, ingredientName
  (snapshot), quantityOrdered Float (in purchase units), quantityReceived Float
  @default(0), unitCost Float (per purchase unit), lineTotal Float, receivingNote String?

API (/api/inventory/):
- CRUD vendors (+[id]); CRUD purchase-orders with nested lines.
- POST purchase-orders/[id]/submit (manager/admin; locks lines, stamps orderedAt).
- POST purchase-orders/[id]/receive body [{lineId, quantityReceivedDelta,
  receivingNote?}] — assigned store users may receive; sets PARTIALLY_RECEIVED /
  RECEIVED. Receiving updates VendorIngredient.casePrice AND
  Ingredient.purchaseCost + costPerReportingUnit (most-recent-cost method).
- POST purchase-orders/[id]/cancel (manager/admin; DRAFT/SUBMITTED only).
- GET ingredients/[id]/vendor-prices: VendorIngredient rows normalized to cost per
  reporting unit, cheapest flagged.
- POs are store-scoped via getUserStoreScope().

UI:
- inventory/vendors/page.tsx: list + create/edit dialog (terms, lead time).
- inventory/purchase-orders/page.tsx: list (store/status/date filters). New-PO flow:
  store + vendor + expected date; add lines via ingredient typeahead (unit cost
  pre-filled from VendorIngredient, cheaper-vendor hint shown when applicable);
  running total; Save Draft / Submit.
- inventory/purchase-orders/[id]/page.tsx: detail + Receive mode (per-line received
  qty defaulting to remaining, discrepancy notes, partial receipts); status timeline.
- Sidebar Inventory section gains Vendors and Purchase Orders.

ACCEPTANCE:
- Full DRAFT→SUBMITTED→PARTIALLY_RECEIVED→RECEIVED lifecycle; receiving updates the
  ingredient's cost per reporting unit everywhere it's displayed.
- Second vendor with a lower normalized price triggers the comparison hint.
- Vendor with POs can't be deleted (soft-disable).
- lint + build pass.
```

## Phase I-3 — Storage areas & count sheets

```
Continue in the Froot repo. requireModule("inventory"). StorageArea exists in the
schema already; ItemStorageMapping must be re-pointed to ingredients.

GOAL: Per-store storage areas (Walk-in, Freezer, Front Counter, Dry Storage...) each
holding an ordered list of INGREDIENTS — the template a physical count walks through.
Storage areas exist so counting is walk-the-room fast: you count area by area instead
of hunting for items, and different people can count different areas at once. The
same org-wide ingredient library gets a DIFFERENT area layout per store.

CORE RULES (drive every design decision below):
- An ingredient must be assigned to ≥1 storage area in a store before it can be
  counted there. Assignment is PER STORE.
- One ingredient may live in MULTIPLE areas of the same store (boba straws at Front
  Counter AND Dry Storage) — each assignment is its own count line later (I-4).
- Areas are per-store; ingredients are org-level. Because the library is shared,
  cross-store features (copying layouts in I-3, transfers in I-6) never need
  item-mapping between locations — same ingredientId everywhere.
- Archiving/deactivating an ingredient (I-1b) hides it from area pickers and future
  count sheets but PRESERVES its mappings, so restoring it puts it right back in
  its areas. Deleting a mapping only removes the assignment, never the ingredient.

SCHEMA:
- Replace ItemStorageMapping.squareCatalogObjId with ingredientId FK (drop + recreate
  the model as IngredientStorageMapping if cleaner: id, storageAreaId FK cascade,
  ingredientId FK, sortOrder — @@unique([storageAreaId, ingredientId])). There is no
  production inventory data; a destructive migration is acceptable.
- StorageArea: ensure sortOrder Int @default(0) exists (area order = the order the
  count walks the store).

API:
- CRUD /api/inventory/storage-areas (store-scoped; manager/admin mutations); reorder
  via sortOrder.
- PUT /api/inventory/storage-areas/[id]/ingredients: replace ordered list
  [{ingredientId, sortOrder}].
- POST /api/inventory/storage-areas/assign (manager/admin): bulk assignment —
  {storeId, ingredientIds[], addAreaIds[], removeAreaIds[]} → upserts/deletes
  mappings (new mappings append at the end of each area's order). This is the same
  endpoint the I-4 unassigned-item triage panel will call.
- GET /api/inventory/storage-areas?storeId=... → areas with mappings joined to
  Ingredient (name, brand, category, reporting unit, costPerReportingUnit), PLUS an
  unassigned[] array: active ingredients with no mapping in this store.

UI (inventory/storage-areas/page.tsx, store selector at top):
- "By area" view: reorderable area cards (@dnd-kit, already a dependency); inside
  each area a searchable ingredient picker (active ingredients only; exclude ones
  already in that area), drag to reorder (shelf-to-sheet order), remove (removes
  the mapping only). Inline add/rename/delete of areas; deleting an area with
  mappings requires the confirmation AlertDialog and frees its ingredients back to
  unassigned (it never deletes ingredients).
- "By ingredient" view — the bulk workhorse: table of active ingredients with an
  "Areas" chip column, group-by (category | vendor | unassigned-first) + search,
  row checkboxes with select-all-in-group; a sticky "Assign to areas…" action opens
  a checkbox dialog of this store's areas (add AND remove in one save) → calls the
  bulk endpoint. This is how 200 ingredients get organized in minutes.
- Unassigned banner: when unassigned[] is non-empty, show a warning banner with the
  count ("14 ingredients can't be counted yet") linking to the By-ingredient view
  pre-filtered to unassigned. Default to that view when unassigned items exist.
- "Copy areas from another store" (admin): duplicates areas + mappings + ordering
  onto the current store (merge-add; skip mappings that already exist). Confirmation
  dialog lists what will be created. This is the multi-store rollout path: build the
  layout once at store #1, copy to new stores, then tweak.
- Mobile: this page gets used standing in a walk-in — keep it usable at phone width
  (areas collapse to an accordion; tap targets ≥ 44px).

ACCEPTANCE:
- Two stores arrange different areas over the same ingredient library; copy-from-
  store then diverging one store leaves the other untouched.
- Bulk-assign 20 ingredients to 2 areas in one action; same dialog removes them.
- An ingredient in 2 areas of one store shows one chip per area; unassigned banner
  count drops as assignments happen and disappears at zero.
- Archived ingredient disappears from pickers/By-ingredient view but its mappings
  survive a restore.
- Managers restricted to assigned stores.
- lint + build pass.
```

## Phase I-4 — Physical counts & sitting inventory

```
Continue in the Froot repo. InventoryCount/InventoryCountLine exist but are keyed to
Square object ids — re-point them to ingredients (destructive migration OK, no prod
data). requireModule("inventory").

GOAL: Count workflow: start a count for a store, walk storage areas entering
quantities in REPORTING UNITS (with purchase-unit helpers), finalize to compute
sitting inventory value.

SCHEMA (revise InventoryCountLine): id, inventoryCountId FK cascade,
storageAreaId FK?, ingredientId FK, ingredientName (snapshot), reportingUnit (snapshot),
quantityCounted Float, costPerReportingUnit Float (snapshot at count start),
lineValue Float?, usageVariance Float?

API (/api/inventory/counts):
- POST create {storeId} → Draft count; snapshot lines from the store's storage areas
  (name/unit/cost frozen at count start so later price changes don't rewrite history).
  Ingredient in multiple areas = one line per area.
- GET list (store/status filters); GET [id] grouped by storage area.
- PATCH [id]/lines: batch upsert {lineId, quantityCounted}[] — autosave-friendly.
- POST [id]/finalize (manager/admin): lineValue = qty × cost; sum → sittingInventoryVal;
  finalizedAt, status Finalized, completedByUserIds. Immutable afterward (409).
- DELETE Draft only.

COUNT WORKFLOW REFINEMENTS (these are what make counting fast in practice):
- Opening a draft: if active ingredients exist that are assigned to NO storage area
  for this store, show a triage panel first — assign selected to areas, or archive
  them. An unassigned ingredient cannot be counted.
- Mid-count add: at the bottom of each area, a searchable list of active ingredients
  not in that area with an "add & count" action — no leaving the draft to fix setup.
- Count entry: numeric input in the reporting unit, a toggle to enter whole purchase
  units instead ("+ case" adds unitsPerPurchase), +/- steppers for each-type items.
- Sheet-to-shelf re-sort: after an area is fully counted, offer "re-sort this area
  by the order you just counted" — preview, confirm, and it becomes the area's saved
  default order for the next count.
- Per-area completion checkmarks; multiple users can count different areas of the
  same draft concurrently (the batch line PATCH already supports this).
- Finalize dialog: count name, notes, finalized date-time (default = last edit time;
  this timestamp defines the inventory period boundary), and a "partial count" flag.
  PARTIAL COUNTS ARE EXCLUDED from usage/COGS period math (I-5 must skip them when
  pairing consecutive counts).
- Count by weighing: Ingredient gains tareWeightOz Float?, fullWeightOz Float?
  (container empty/full weights, stored in oz (dry); UI accepts lbs/oz/g/kg and
  converts). In count entry, ingredients with weights saved get a "weigh" mode:
  enter gross scale weight → volume-type items compute fraction remaining
  ((gross − tare) / (full − tare), clamped 0–1) × units per container; weight-type
  items compute net = gross − tare converted to the reporting unit. Result saves as
  a normal quantityCounted — downstream math unchanged.
- Offline-tolerant entry: line saves queue client-side when a PATCH fails or
  navigator.onLine is false; retry with backoff on reconnect. Indicator states:
  "All changes saved" / "Saving…" / "Offline — N counts pending". beforeunload
  warning while edits are pending. No service worker needed — just don't lose
  keyed-in counts on a walk-in's dead wi-fi.

SCHEMA additions for the above: InventoryCount.name String?, notes String?,
isPartial Boolean @default(false).

POST-FINALIZE REVIEW & CORRECTIONS (counts are records, not tombstones — data-entry
errors must be fixable where they happened):
- GET [id]/summary: per-ingredient rollup across areas — total qty, snapshot cost,
  line value; sortable by value (spot $0.00 lines = missing cost, and abnormally
  large lines = unit/case miscounts); per-ingredient pop-over comparing this count's
  per-area quantities to the previous finalized count's.
- Finalized counts reject normal line PATCHes (409) but accept corrections via
  POST [id]/corrections (manager/admin): {lineId, quantityCounted? , 
  costPerReportingUnit?, note} — recomputes lineValue + count total and appends to
  an InventoryCountCorrection audit table (countId, lineId, field, oldValue,
  newValue, note, userId, createdAt).
- Flag any line whose snapshot cost differs >50% from the ingredient's CURRENT
  costPerReportingUnit (red badge, "cost changed since count — correct this line?").

UI:
- inventory/counts/page.tsx is the store's inventory home, two stacked parts:
  OVERVIEW header (per selected store): current sitting inventory $ (total of the
  most recent FINALIZED, non-partial count), that count's name / finalized
  date-time / counted-by, "days since last count", and one primary action —
  "Continue draft" (with draft age + who's been counting) when a Draft exists,
  else "Start new count". A store with no finalized counts gets a first-count
  empty state: the first finalized count establishes opening stock, so
  usage/COGS math (I-5) only begins after it.
  HISTORY table below: every count newest-first (name, finalized date-time,
  status, total value, counted-by, partial badge, corrections badge when > 0).
  Row click: Draft → resume counting; Finalized → the [id]/summary review view.
  Build rows as a generic event shape {type, date, label, value, href} — I-6
  interleaves loss / transfer / prep-event rows into this same timeline so the
  history reads as everything that changed inventory between counts.
- inventory/counts/[id]/page.tsx: mobile-first counting screen — area list with
  completion checkmarks, big numeric inputs, debounced autosave with a visible
  "all changes saved" indicator, progress (n of m), running total, Finalize dialog
  as specified above.
- Dashboard: "days since last count" card per store when module active.

ACCEPTANCE:
- Full count flow works on a phone-sized viewport.
- Finalize idempotent; value = Σ lines; later cost changes don't alter finalized
  counts; a partial count never appears as a period boundary in I-5 reports.
- Unassigned-ingredient triage appears when applicable; sheet-to-shelf re-sort
  persists as the area's new default order.
- Overview header shows the latest finalized non-partial count's value (a newer
  partial count changes the history table but NOT the sitting-inventory figure);
  "Continue draft" resumes the existing draft instead of creating a second one
  (enforce one Draft per store — 409 on duplicate create).
- Weigh mode: a 60%-full container computes the right partial quantity; a
  correction on a finalized count updates the total and leaves an audit row.
- Killing the network mid-count queues edits and flushes them on reconnect.
- lint + build pass.
```

## Phase I-5 — Sales sync, usage, COGS & analytics

```
Continue in the Froot repo. requireModule("inventory"). Read src/lib/square.ts.

GOAL: Pull sales from Square Orders and close the COGS loop:
Usage $ = beginning inventory + received purchases − ending inventory, per store per
period (period = span between two finalized counts). Cost % = Usage / Sales.

SCHEMA:
- SalesPeriodCache: id, organizationId, storeId, date (@db.Date), grossSales Float,
  netSales Float (pre-tax: gross − Square total_tax_money − discounts), taxTotal
  Float, discountTotal Float, orderCount Int — @@unique([storeId, date]).
- SalesLineCache: id, organizationId, storeId, date (@db.Date),
  squareVariationId String, quantitySold Float, grossSales Float —
  @@unique([storeId, date, squareVariationId]). (Per-variation sales enable the
  item-level report here and theoretical usage/variance in I-6.)
- SalesHourlyCache: id, organizationId, storeId, date (@db.Date), hour Int (0–23,
  store-local), netSales Float, orderCount Int — @@unique([storeId, date, hour]).
  (Feeds the Dashboard's intraday pace chart in D-1 — populate it now, same pass.)

SQUARE:
- POST /api/square/sales/sync {storeId, startDate, endDate}: SearchOrders
  (location_id = store.squareLocationId, state COMPLETED, closed_at filter, cursor
  pagination); aggregate per day into all three caches (hourly bucketed in the
  store's timezone from Square's location settings). Store without
  squareLocationId → 400 with a clear message.
- Sync is idempotent per day (upsert on the unique keys); re-syncing a date range
  replaces those days. NO manual sales entry, CSV upload, or tax-percent setting —
  Square is the source of truth for gross/net/tax (net = pre-tax, pre-discount-
  adjusted; hover copy on the UI should say which).

REPORTING API (/api/inventory/reports/):
- cogs?storeId=&from=&to=: per period between consecutive finalized counts —
  beginning count value, received-PO value in window (Σ quantityReceived × unitCost),
  ending count value, sales from cache (sync gaps on demand),
  usage = beginning + purchases − ending, costPct = usage / sales.
  Also break usage down by IngredientCategory GL code (line-level values).
  NEGATIVE USAGE is a data-entry alarm, not a result: any per-ingredient usage < 0
  ("ended with more than beginning + received") renders red with a hint listing the
  three usual causes — miscount on either boundary count, a delivery received into
  the wrong period (date/time boundary), or a missing PO/transfer/prep record.
  Usage math must net in adjustments once I-6 lands: + transfersIn − transfersOut,
  prep consume/produce rows, loss counted within usage but also reported as its own
  line. (I-7's estimated on-hand is the same idea run forward — "expected
  inventory" between counts.)
- valuation?date=: sitting value per store (latest finalized count ≤ date) + company-wide.
- turnover?storeId=&from=&to=: per ingredient — usage qty vs. avg on-hand; flag fast
  movers (top decile) and dead stock (no usage 2+ periods).
- vendor-spend?from=&to=: received value per vendor, monthly trend, avg lead time
  (received − orderedAt).
- item-sales?storeId=&from=&to=: per Square variation — quantity sold, gross sales,
  avg price (gross/qty), % of store sales; joined to SalesItem for display name and
  menu group; group-by menu group rollup. (I-6 adds mapped-status, theoretical cost,
  and profit columns to this same report once recipes exist.)

UI — REPORTS LIVE UNDER THE INVENTORY MENU (this is a reporting suite, not a page):
- New "Reports" entry in the sidebar's Inventory section → inventory/reports.
  Do NOT scatter these under the app-level (app)/reports page; that page just links
  here when the module is active.
- Persistent report header on every tab: store picker + period picker. Period picker
  offers INVENTORY PERIODS first (spans between consecutive finalized counts, named
  by their boundary counts — reports are most meaningful across a full period) with
  custom date range as the fallback. Partial counts never appear as period
  boundaries.
- Tabs:
  1. SUMMARY — headline cards (Sales, Usage $, Cost %, Sitting Inventory $, Weeks
     on hand = sitting / avg weekly usage), each with an info hover explaining its
     math; recharts cost % by period trend; top-10 / bottom-10 sellers by gross
     sales (toggle), so pricing decisions start here; sales-by-menu-group and
     usage-by-GL-category tables at the bottom.
  2. ITEM SALES — the item-sales report above: sortable columns, menu-group
     grouping, search; empty-state prompts a sales sync if the cache has gaps.
  3. PERIODS (COGS) — the cogs report: per-period rows (beginning, purchases,
     ending, usage, sales, cost %), expandable to the GL-category breakdown with
     negative-usage red flags + cause hints as specified above.
  4. VALUATION / 5. TURNOVER / 6. VENDOR SPEND — as specified above.
  (I-6 appends tabs 7. VARIANCE and 8. PROFITABILITY to this same suite — actual
  vs. theoretical usage per ingredient and per-item profit — keep the tab structure
  extensible.)
- Sync affordance: "Sales synced through {date} · Sync now" in the report header;
  syncing missing days happens on demand when a report requests uncached dates.

ACCEPTANCE:
- Sandbox: two finalized counts + one received PO + synced sales → hand-checked
  usage and cost % in the PR description.
- Sales sync idempotent per day; hourly cache totals per day equal the daily cache.
- Reports are reachable only under the Inventory menu (requireModule) and every tab
  respects getUserStoreScope().
- An inventory period selected in the picker gives identical numbers on Summary and
  Periods tabs.
- lint + build pass.
```

## Phase D-1 — Store Dashboard redesign (run after I-5)

```
Continue in the Froot repo. Requires Phase I-5 (sales caches + sync). The Dashboard
is NOT module-gated — it's the page every store user lands on after login — but the
sales boxes require the inventory module + a Square-linked store, and must degrade
gracefully without them.

DESIGN SOURCE OF TRUTH: froot_docs/dashboard-design/ in this folder —
README.md (full spec: layout, per-component styles, state shapes, design tokens)
and Dashboard.dc.html (high-fidelity static reference). Recreate the design with
this codebase's existing stack (shadcn/ui, Tailwind 4 CSS variables, recharts);
do NOT copy/embed the prototype HTML. Where the README's tokens overlap existing
theme variables, extend the theme rather than hardcoding hex values. Keep the
app's EXISTING sidebar nav items and routes — adopt the design's sidebar styling,
not its placeholder nav list.

SCOPE: This phase builds the page layout, the two SALES boxes with real data, and
the goal system. Team Messages, Corporate Update, Shift Checklist, and Instagram
render as fully styled boxes fed by clearly-marked mock data behind typed
interfaces (matching README's "State Management" shapes) — their backends are
later builds and must be swappable without relayout.

SCHEMA:
- StoreMonthlyGoal: id, organizationId, storeId FK, month (@db.Date, first-of-
  month), goalAmount Float — @@unique([storeId, month]). CRUD API
  (manager/admin); staff read-only.

API — GET /api/dashboard/summary?storeId= (store-scoped):
- today: net sales so far + hourly series (SalesHourlyCache; trigger an on-demand
  sync of today if stale > 15 min).
- comparison: SAME WEEKDAY LAST YEAR (e.g. Tue Jul 2 '26 vs Tue Jul 4 '25 — nearest
  same-weekday date): that day's total + hourly series; sync on demand if uncached.
  (README mentions weather-matched comparison days — out of scope; weekday match
  only. Leave the comparison series behind an interface so a smarter matcher can
  swap in later.)
- month: MTD net sales, goalAmount for the current month, daysElapsed, daysInMonth.

BOXES (layout, styles, copy per README — the deltas below are data wiring):
1. Sales Performance: "TODAY SO FAR" vs "SAME {WEEKDAY}, LAST YR" totals, delta
   pill (green up / warning down), hourly pace polyline chart (today solid brand
   orange, last year muted). No Square link / module off → box shows a
   "Connect Square to see sales" empty state.
2. Monthly Goal: goal, MTD actual, progress bar, "% of goal · $N to go",
   extrapolation block: extrapolated = MTD / daysElapsed × daysInMonth;
   pctToGoal = extrapolated / goal; success tone ≥ 100%, warning tone < 100%;
   "N days left in {month}" pinned to bottom. No goal set → inline "Set a goal"
   (manager/admin opens a small editor; staff sees a neutral prompt).
3. Team Messages: mock feed (interface TeamMessage {sender, initial, timestamp,
   text}) — later build.
4. Corporate Update: gradient announcement card, mock pinned update — later build.
5. Shift Checklist: if the repo already has checklist/task models, wire a
   read-only summary of today's list for the logged-in store (n/m complete,
   toggleable rows, "View full checklist →"); otherwise mock behind
   interface ChecklistItem {label, checked} — later build.
6. Instagram strip: striped placeholder thumbnails + "@kevajuice_reno →" link per
   README; fetching real posts (Instagram Graph API) is a later build — leave a
   typed provider stub.

STORE CONTEXT: the dashboard shows the user's logged-in store; users scoped to
multiple stores get the store picker in the page header (defaults to last used,
persisted). Header subline = "{weekday}, {date} · {store name}".

ACCEPTANCE:
- Pixel-close to Dashboard.dc.html at ~1500px; cards reflow 2-up → 1-up on tablet
  widths (flex-wrap + min-width, no separate layout).
- Extrapolation math: MTD $34,200 on day 17 of 31 → $62,364 projected; against a
  $58,000 goal shows 107.5% in success tone.
- Delta pill: today $1,842 vs last-year $1,650 → "▲ 11.6%".
- Checklist toggles update the header count live; carousel arrows scroll.
- Module off / no Square / no goal / no last-year data each render a designed
  empty state, never a crash or blank box.
- lint + build pass.
```

## Phase I-6 — Recipes, theoretical cost & the needs-attention queue

```
Continue in the Froot repo. requireModule("inventory"). Read src/lib/units.ts,
Phase I-1 (SalesItem, Ingredient) and I-5 (SalesLineCache) code.

GOAL: Recipes link each sellable Square variation to ingredient quantities →
theoretical cost per menu item, plus the triage queue for unmapped sales items.
Also: inventory adjustments (waste/transfer/comp).

SCHEMA:
- Recipe: id, organizationId, name, salesItemId FK? @unique (the variation this recipe
  costs; null = sub-recipe/batch like "Cup Kit - 32oz"), yieldQty Float @default(1),
  yieldUnit String @default("serving"), isActive, updatedAt
- RecipeLine: id, recipeId FK cascade, ingredientId FK? , subRecipeId FK? (exactly one
  set — enforce in Zod), amount Float, unit String (a usage unit: "fl. oz",
  "oz (dry)", "each", "serving"...)
- SalesItem: add recipeStatus String @default("UNMAPPED")
  // UNMAPPED | MAPPED | NON_RECIPE (modifier junk, $0 rows, one-off POS buttons)
- InventoryAdjustment: id, organizationId, storeId, ingredientId FK, ingredientName,
  type ("WASTE"|"TRANSFER_IN"|"TRANSFER_OUT"|"COMP"|"CORRECTION"), quantity Float
  (reporting units), costPerReportingUnit Float, value Float, reason String?,
  createdByUserId, createdAt

COST ENGINE (src/lib/recipe-cost.ts):
- recipeCost(recipeId): Σ lines — ingredient lines convert line.unit →
  ingredient.reportingUnit via src/lib/units.ts and multiply by costPerReportingUnit;
  sub-recipe lines recurse (cost / yieldQty × amount). Cycle detection → error.
  Dimension-mismatch (fl. oz of a lbs-based ingredient) → validation error surfaced
  in the UI, never silent 0.
- costPct(salesItem) = recipeCost / (priceCents/100); null when price is 0/absent.

API:
- CRUD /api/inventory/recipes with nested lines (manager/admin). GET includes computed
  cost, per-line cost, and margin.
- PATCH /api/inventory/sales-items/[id]: set recipeStatus (mark NON_RECIPE), attach
  recipe. POST /api/inventory/recipes/[id]/duplicate {salesItemId} — copy a recipe to
  another variation (build L once, duplicate to M/S/Kids, tweak amounts).
- CRUD /api/inventory/adjustments (store-scoped; STAFF can log waste; manager+ for
  corrections; transfers create paired IN/OUT rows across two stores).

TRANSFERS (multi-store movement must be first-class, or usage lies at both stores —
transfers OUT reduce the sender's stock without counting as its usage-by-sales,
transfers IN add to the receiver's):
- A transfer is ONE record with a header (fromStoreId, toStoreId?, occurredAt
  date-time — backdatable so it lands in the right inventory period, note) and
  MULTIPLE lines (ingredient, qty, unit convertible to the ingredient's dimension).
  Saving writes paired TRANSFER_OUT/TRANSFER_IN InventoryAdjustment rows sharing a
  transferGroupId. Because ingredients are org-level (I-3 core rule), no item
  mapping between stores is ever needed.
- Custom destination: toStoreId null + destinationLabel String ("Kitchen",
  "Catering — Smith wedding") = an outbound-only transfer to a named non-tracked
  destination; writes TRANSFER_OUT rows only. Org's previously used labels offered
  as suggestions.
- Transfer log view: grouped by transferGroupId (header + lines), filterable by
  store/date/destination; each finalized inventory period shows its transfers in/out
  totals in the I-5 period detail.

LOSS:
- LossReason: id, organizationId, label, isDefault — seed Spoilage, Breakage, Comp,
  Theft/Unknown; org can add custom reasons. InventoryAdjustment gets
  lossReasonId FK? (WASTE/COMP rows).
- Loss entry mirrors transfers: one record, multiple lines, backdatable date-time,
  reason + note; quick-log stays one-tap simple for a single spoiled item.
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
- "Record prep" action (any assigned store user): pick a countable recipe, a batch
  multiplier (½ / 2× / custom), store, date, notes → writes paired
  InventoryAdjustment rows: type PREP_CONSUME (negative, one per ingredient line,
  quantities × multiplier) and PREP_PRODUCE (positive on the prepared ingredient,
  yieldQty × multiplier). Add both types to the InventoryAdjustment type enum and
  fold them into the I-5/I-7 usage and on-hand math.
- Prepared ingredients are countable in storage areas (I-3/I-4 pickers include
  them) and usable as recipe lines like any other ingredient.
- Prep history is visible in the adjustments log filtered to prep types, with a
  "re-record" shortcut that pre-fills the last batch.

UI:
- inventory/recipes/page.tsx: sales items grouped by menu group (mirroring how
  operators think), columns: displayName, price, recipe cost, cost %, status badge;
  filter "Needs attention" (UNMAPPED with price > 0 first); bulk "mark non-recipe";
  a separate "Prep recipes" tab for countable sub-recipes with a Record Prep button.
- inventory/recipes/[id]/page.tsx: recipe editor — ingredient/sub-recipe typeahead,
  amount + unit inputs (unit dropdown limited to units convertible to the
  ingredient's dimension), live per-line cost + total + cost % as you type, duplicate-
  to-variation button.
- inventory/adjustments/page.tsx: quick-log form (store, ingredient typeahead, type,
  qty, reason) + filterable history.
- EXTEND THE I-5 REPORTS SUITE (inventory/reports) with two tabs:
  7. VARIANCE — per ingredient: amount used (usage equation) vs. amount sold
     (Σ mapped sales × recipe amounts, sub-recipes expanded), variance qty + $,
     biggest $ gaps first; group by category / vendor / all items; hover on Used
     and Sold columns shows the math. Cause hints: negative variance (used > sold)
     → over-portioning, unrecorded loss/comps, missing delivery, mapping mistake;
     positive (sold > used) → miscount, negative usage, mapping mistake. Only
     ingredients present on boundary counts or mapped to something sold appear.
  8. PROFITABILITY — per sales item over the period: qty sold, gross sales,
     recipe cost, cost %, gross profit $; sortable; menu-group rollup; UNMAPPED
     items surface with a "map it" link into the recipes triage queue.
- SalesItem gains unitAdjustment Float @default(0) per period? NO — keep it simple:
  a manual per-item sold-quantity adjustment lives on the variance tab only
  (VarianceAdjustment: storeId, salesItemId, periodKey, qtyDelta, note) for known
  comps/waste rung up wrong, so mapping data from Square stays untouched.

ACCEPTANCE:
- Rebuild All That Razz (L) from the Keva export (2.3 fl. oz juice @ $0.2241/fl. oz →
  $0.52; 8 fl. oz sherbet; 2.32 oz dry bananas; 6 oz dry strawberries; 1 serving
  Cup Kit sub-recipe) → total ≈ $2.14 and cost % ≈ 25.2% at $8.49. Include this as a
  seed/test fixture.
- Sub-recipe cycle rejected with a clear, named error listing the recipes in the
  loop ("A → B → C → A") so the user knows which reference to break; a looped
  recipe shows cost N/A rather than $0.
- Recording a prep batch decrements ingredient on-hand estimates, increments the
  prepared item, and the prepared item is countable in a draft.
- A 3-line transfer between two stores writes 6 adjustment rows sharing one
  transferGroupId; a "Kitchen" custom transfer writes OUT rows only; both land in
  the inventory period matching their backdated occurredAt.
- Received PO price change updates recipe costs.
- lint + build pass.
```

## Phase I-7 — Reorder points, estimated on-hand & alerts

```
Continue in the Froot repo. requireModule("inventory"). Read Phases I-2, I-4, I-6.

GOAL: Per-store ingredient level targets, estimated on-hand between counts, low-stock/
overstock alerts. On-hand between counts is an ESTIMATE (periodic model) — label it.

SCHEMA:
- StoreIngredientLevel: id, organizationId, storeId FK, ingredientId FK,
  reorderPoint Float?, parLevel Float?, maxLevel Float? —
  @@unique([storeId, ingredientId])
- InventoryAlert: id, organizationId, storeId, ingredientId, ingredientName,
  type ("LOW_STOCK"|"OVERSTOCK"), estimatedOnHand Float, threshold Float,
  status String @default("OPEN") // OPEN | ACKNOWLEDGED | RESOLVED
  , createdAt, acknowledgedByUserId String?

ESTIMATED ON-HAND (lib, reused by reports):
last finalized count qty + PO receipts since − adjustments since (waste/transfers)
− estimated usage (avg daily usage from last 2–3 count periods × days elapsed;
use theoretical usage from I-6 when recipe coverage > 80%, else historical average;
0 if no history).

API:
- PUT /api/inventory/levels (batch upsert; manager/admin)
- GET /api/inventory/on-hand?storeId= — per-ingredient estimate + level status
- POST /api/inventory/alerts/evaluate — recompute (called after count finalize, PO
  receive, adjustment create; plus a daily Vercel cron). Dedupe OPEN alerts per
  store+ingredient+type.
- PATCH /api/inventory/alerts/[id] — acknowledge/resolve.
- Email digest of new LOW_STOCK alerts to org admins + store managers (add Resend
  with an env key if no transport exists). SMS out of scope.

UI:
- Reorder/par/max columns editable on the Ingredients page per selected store.
- inventory/alerts/page.tsx: open alerts, acknowledge, store filter; badge count on
  the sidebar Inventory section.
- On-hand column ("estimated" tooltip + as-of date) on the Ingredients page;
  dashboard card with open low-stock count per store.

ACCEPTANCE:
- Count below reorder point → one alert + email; re-evaluate doesn't duplicate;
  receiving stock above threshold auto-resolves.
- lint + build pass.
```

## Phase M-1 (optional) — Migrate Keva's existing data

```
Continue in the Froot repo. requireModule("inventory").

GOAL: One-time importers so Keva starts with real data instead of blank screens.
Inputs are the operator's own data exports (xlsx), e.g.:
- An items export: brand+name, reporting unit, cost/pack ("$32.85/box (40lbs)"),
  category + GL code, vendor.
- A sales-items export: per menu group — name, POS ID, recipe name, sales price,
  cost, cost %, category, subcategory.
- Per-recipe exports: header (name, POS ID, menu group, price, yield, cost %) +
  ingredient lines (category, ingredient, amount, unit, cost) + sub-recipe lines.

BUILD:
- scripts/import-inventory.ts (pattern: scripts/import-keva-templates.ts): parse with
  the xlsx package (already a dependency); flags --org <clerkOrgId> --items <file>
  --recipes <dir> --dry-run.
- Items → IngredientCategory (with GL code) + Ingredient + VendorIngredient (parse
  pack strings like "case (2 x 36fl. oz (bottle))" into unitsPerPurchase where
  possible; log unparseable rows for manual fixup).
- Recipes → match POS ID to synced SalesItem.squareVariationId; create Recipe +
  RecipeLines (ingredient fuzzy-match by name with a review report of non-exact
  matches); category "recipe" lines become sub-recipe references.
- Dry-run prints a summary + all warnings; real run is transactional per entity type.

ACCEPTANCE:
- Dry-run on the provided Keva exports reports totals and warnings; import then
  produces a recipes page where All That Razz (L) shows ≈25.2% cost.
```

---

# NUTRITION MODULE

## Phase N-1 — Menu items, variant-level nutrition, review workflow

```
You are working in the Froot repo (see CLAUDE.md; org scoping, Zod, requireAdmin).
Gate with requireModule("nutrition"). MenuItem/MenuItemNutrition/MenuItemAllergen
exist in schema.prisma. If Phase I-1 has been built, reuse the SalesItem sync as the
source; otherwise call Square directly with the same src/lib/square.ts helper.

GOAL: Nutrition data manager. Two design rules learned from the Keva prototype
(kevajuice-iy6gjegy.manus.space):
(1) Nutrition is PER SIZE VARIANT (Kids/S/M/L differ), not per item.
(2) Synced items must be REVIEWED before publishing — raw catalogs contain modifier
    junk, duplicates, and bad data that must never reach the public page.

SCHEMA CHANGES:
- MenuItemVariant: id, menuItemId FK cascade, squareVariationId String?, name ("Kids",
  "S", "M", "L", "12oz"), servingSize String?, ordinal Int, isActive Boolean
- Move MenuItemNutrition to menuItemVariantId @unique (no prod nutrition data; swap FK).
- MenuItem: add status String @default("DRAFT") // DRAFT | PUBLISHED | HIDDEN
  , imageUrl String?, dietaryFlags String[] @default([]) // VEGAN, VEGETARIAN,
  GLUTEN_FREE, DAIRY_FREE, NUT_FREE, HALAL, KOSHER
  , ingredientsText String?, overriddenFields String[] @default([])
- MenuItemAllergen stays per-item.

SYNC:
- POST /api/nutrition/sync (admin): upsert MenuItem (name/description/category) +
  MenuItemVariant per Square variation. New items arrive DRAFT. Never overwrite
  locally edited fields (tracked in overriddenFields).

API:
- GET /api/nutrition/items?status=&category=&q= (variants + nutrition included)
- PATCH /api/nutrition/items/[id]: fields, status, dietary flags, allergens.
- PUT /api/nutrition/variants/[id]/nutrition: upsert full facts panel (Zod:
  non-negative, calories int).
- POST /api/nutrition/items/bulk {ids, action: "publish"|"hide"}; publishing items
  lacking nutrition data returns a warning list.

UI:
- nutrition/page.tsx: item table — status badge, category filter, "needs attention"
  filter (published w/ missing calories, or calorie outliers > 2000 flagged), search,
  bulk publish/hide.
- nutrition/[id]/page.tsx: item editor — name/description/category/image, dietary
  flags, allergen checklist, ingredient statement, variant grid where each size
  expands into the full FDA-style facts editor (serving size, calories, fats,
  cholesterol, sodium, carbs, fiber, sugars, added sugars, protein, vitamin D,
  calcium, iron, potassium).
- Sidebar "Nutrition" link when module active.

ACCEPTANCE:
- Sync creates DRAFTs only; outlier flagging catches a 5,000-cal item; local edits
  survive re-sync; lint + build pass.
```

## Phase N-2 — Public nutrition page + embed for subscriber websites

```
Continue in the Froot repo. Read Phase N-1 code first.

GOAL: Each org gets a public, brandable nutrition site — hosted by Froot, embeddable
in the customer's own website. PUBLISHED items only.

SCHEMA:
- NutritionSiteSettings: id, organizationId @unique, slug String @unique (default from
  Organization.slug), displayName, logoUrl, brandColor String?, accentColor?,
  isEnabled Boolean @default(false), showAllergens Boolean @default(true),
  showIngredients Boolean @default(true), footerDisclaimer String? (default the FDA
  menu-labeling advisory sentence about 2,000 calories/day)

PUBLIC ROUTES (no auth — outside the (app) group, like src/app/print/):
- src/app/menu/[slug]/page.tsx: server-rendered. IA mirrors the Keva prototype:
  sticky header (brand + search), horizontal category chip nav, items grouped by
  category, each row = name + size list + calorie range (min–max across variants),
  expanding to per-size facts panel, dietary icons, allergens, ingredient statement.
  Mobile-first, brandColor CSS variables, revalidate ~300s.
- GET /api/public/menu/[slug]: same data as JSON; CORS allow *; cache headers.
- Embed: public/embed.js + iframe support — /menu/* must render in an iframe
  (frame-ancestors adjusted for that path only in next.config.ts headers).

ADMIN UI:
- nutrition/site/page.tsx (admin): enable/disable, slug editor (uniqueness check),
  branding with live preview iframe, "Share & embed" card: direct link, responsive
  <iframe> snippet, <script src=".../embed.js" data-slug="..."> snippet, copy buttons.

ACCEPTANCE:
- Draft/hidden items never appear publicly. Disabled site → 404. Slug change 404s
  the old slug. ≥90 Lighthouse mobile perf. Iframe works from another origin.
- lint + build pass.
```

## Phase N-3 — Square write-back of nutritional data

```
Continue in the Froot repo. Read src/lib/square.ts and Phase N-1/N-2 code.

GOAL: Push nutrition data back into Square.

SQUARE FACTS (verified against the API reference, version 2026-05-20):
- CatalogItem.food_and_beverage_details exists ONLY for product_type FOOD_AND_BEV:
  calorie_count (int kcal), dietary_preferences[] (STANDARD enums VEGETARIAN, VEGAN,
  HALAL, KOSHER, GLUTEN_FREE, DAIRY_FREE, NUT_FREE + CUSTOM), ingredients[] (standard
  allergen enums + CUSTOM).
- No native field for the full facts panel — that stays in Froot + the public page.
- calorie_count is ITEM-level: write the default variant's calories (add
  defaultVariantId String? to MenuItem; fall back middle size, else first).

IMPLEMENTATION:
- GET /api/nutrition/square-writeback → dry-run diff (item, current Square values,
  proposed values). POST → for each selected PUBLISHED item with squareCatalogObjId:
  RetrieveCatalogObject (current version for optimistic concurrency) →
  UpsertCatalogObjects in batches (~100), setting product_type FOOD_AND_BEV +
  food_and_beverage_details mapped from Froot (dietaryFlags → dietary_preferences,
  allergens → ingredients enums, else CUSTOM).
- UI: "Sync to Square" section on the nutrition list — preview table with checkboxes
  → confirm → progress → result summary with per-item failures.
- Record lastSquareWritebackAt; warn that Square-side manual edits get overwritten.

ACCEPTANCE:
- Dry-run accurate; confirmed sync visibly updates a sandbox item in Square Dashboard;
  version conflicts retry once then fail per-item without aborting the batch.
- lint + build pass.
```

---

# Cross-cutting final phase

## Phase X-1 — Module activation, empty states, QA pass

```
Continue in the Froot repo.

- Settings → Billing: wire the Upgrade buttons. Until real Square subscription
  checkout exists, an env-gated admin toggle (ENABLE_MODULE_SELF_SERVE=true on
  staging) that adds/removes "inventory"/"nutrition" in activeModules. TODO note
  referencing Square Subscriptions API for production checkout.
- Every gated page: friendly upsell empty-state (module name, one-line pitch,
  "Upgrade" → settings) instead of an error on MODULE_NOT_ACTIVE.
- Sidebar sections react to activeModules without hard refresh.
- AuditLog entries for: count finalized, PO submitted/received, adjustment created,
  alert acknowledged, recipe created/edited, item published/hidden, write-back run.
- QA script on staging: sync sales items → import/create ingredients → storage areas
  → two finalized counts → one received PO → sales sync → verify COGS math; build the
  All That Razz (L) recipe → verify ≈25% cost; publish 3 nutrition items → public
  page → iframe embed from a local HTML file → dry-run + real write-back on one
  sandbox item. Report results.
```

---

## Suggested order & rough sizing

| Order | Phase | Size |
|---|---|---|
| 1 | I-1 Sales item sync + Ingredient library | M–L |
| 1b | I-1b Ingredient field parity, lifecycle, duplicates | M |
| 2 | I-2 Vendors, POs & Receiving | M–L |
| 3 | I-3 Storage areas | S–M |
| 4 | I-4 Physical counts | M |
| 5 | I-5 Sales sync + COGS & analytics | M–L |
| 6 | I-6 Recipes + needs-attention queue + adjustments | L |
| 7 | I-7 Reorder points & alerts | M |
| 8 | M-1 Keva data migration (optional, any time after I-6) | M |
| 9 | N-1 Nutrition manager | M |
| 10 | N-2 Public page + embed | M |
| 11 | N-3 Square write-back | S–M |
| 12 | X-1 Activation & QA | S |

One focused Claude Code session per phase. After each: `npm run lint && npm run build`, push to staging, verify, move on.

---

## Design decisions on record

- **Sales items ≠ ingredients.** Square provides sellable items (per variation);
  ingredients are Froot-native. Counts/POs/vendors/areas operate on ingredients only.
  Recipes bridge the two and unit conversion is the costing engine. (Corrected
  2026-07-05 from the v1 pack, which keyed inventory to Square catalog ids.)
- **Module, not standalone app.** One database, one Clerk login, `requireModule()`
  gating. No separate admin password, ever.
- **Square sync is pull-only in v1** (catalog + sales). No pushing stock levels to
  Square — the ingredient↔item mapping is many-to-one via recipes and a push loop
  can corrupt both sides. Nutrition write-back (N-3) is the one deliberate exception,
  admin-triggered with a dry-run preview.
- **Periodic inventory model, not perpetual.** On-hand between counts is a labeled
  estimate. Per-sale depletion is v2.
- **Roles reuse the existing enum.** ADMIN full; MANAGER assigned-store ops + PO
  submit/receive + vendors + recipes; STAFF counts, receiving, waste logging.
- **Never hardcode credentials.** Per-org Square OAuth tokens only.

## Deferred to v2

- Barcode scanning for counts/receiving
- Expiration-date / FIFO lot tracking
- SMS notifications (email + in-app first)
- Auto-generated POs at reorder point (v1 = alerts + suggested-order quantities)
- Vendor contract/renewal tracking and formal scorecards
- Pushing stock levels to Square
- Deriving nutrition facts automatically from recipe ingredients (needs a nutrition
  database per ingredient — natural v2 once recipes are populated)
