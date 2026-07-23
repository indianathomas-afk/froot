# Phase I-7 — Reorder Points, Expected Inventory & Smart Ordering

Copy everything below this line into Claude Code.

---

You are building **Phase I-7 (Reorder points & alerts)** of Froot. Work on the `staging` branch. Read `CLAUDE.md` and `ROADMAP.md` first and follow all existing conventions. Every new route must call `requireModule("inventory")`. When the phase is complete, update the I-7 row in `ROADMAP.md` with status, commit hash, and notes, and commit it with the code.

## Goal

Froot can now compute what we *should* have on hand (I-1 through I-6 gave us counts, receiving, sales sync, recipes, and adjustments). I-7 turns that into action: an **Expected Inventory** engine, **par levels / reorder points per ingredient per store**, **low-stock alerts**, and a **Smart Cart** that builds draft purchase orders automatically. The behavioral model is BevSpot's ordering suite — reference notes are at the bottom. Match the *behavior*, not their UI.

## What already exists (do not rebuild)

- `Vendor` (has `leadTimeDays`, single contact) + `VendorIngredient` (SKU, pack, case price)
- Full PO lifecycle: `purchase-orders` routes with submit/receive/cancel; receiving stamps `receivedAt` and updates costs
- `InventoryCount` periods + `src/lib/reports.ts` (period math: usage = beginning + purchases − ending ± adjustments)
- Sales sync with per-item caches (`src/lib/sales-sync.ts`), recipe cost engine with theoretical consumption mode (`src/lib/recipe-cost.ts`)
- Adjustments (loss/transfer/prep, backdatable), needs-attention queue from I-6
- NOTE: `parLevel` exists on `ItemMetadata` (legacy Square-catalog stub). Do NOT use it — ingredient pars are new, per-store data. Leave `ItemMetadata` alone.

## Part 1 — Expected Inventory engine

New lib `src/lib/expected-inventory.ts`:

- For a store + ingredient set, compute **expected on-hand in reporting units**:
  `expected = last finalized full count qty + received PO qty since count − theoretical sales usage since count (recipes × synced sales, consumption mode) ± adjustments since count`
- Reuse the period/usage logic in `reports.ts` and the recipe consumption math from I-6's variance report rather than reinventing it. Quantities, not just dollars.
- Return per-ingredient metadata the UI needs: last count date, staleness (days since count), whether any component data is missing (no recipe mapping, no sales sync, negative expected).
- Report page `/inventory/expected` (or extend the Reports suite tab pattern from I-5): store picker, "as of last finalized count" starting point, expected qty + value per ingredient, flags for negative/stale rows. BevSpot calls this the Expected Inventory report and treats it as a "self-regulating order guide" — it must work even if sales data is missing for a stretch (degrade to counts + purchases + adjustments and flag reduced confidence).

## Part 2 — Pars & reorder points (per ingredient per store)

New model, e.g. `StoreIngredientPar`:

- `storeId`, `ingredientId`, `parLevel Float?`, `reorderPoint Float?`, unique on the pair. Par and reorder point are in the ingredient's **reporting unit**; the UI shows the purchase-unit equivalent via `units.ts` conversions.
- Editing surfaces: a Pars column/panel on `/inventory/ingredients` (respect the store context) and bulk edit support consistent with the existing bulk-edit pattern from I-1b.
- Also compute **average weekly usage** per ingredient per store (from inventory-period usage or synced sales, whichever the data supports — prefer real period usage when ≥1 full period exists). Show it beside the par input; BevSpot's guidance is "if unsure of pars, order to usage for a few weeks to discover them."

## Part 3 — Low-stock alerts

- Alert condition: `expected on-hand < reorderPoint` (or `< parLevel` when no reorder point is set — reorder point wins when both exist).
- `/inventory/alerts` (or a section on the inventory dashboard): grouped by store, showing expected qty, par/reorder point, suggested order qty (to reach par, rounded UP to whole purchase units/cases), primary vendor, and last count staleness.
- Feed these into the existing needs-attention queue pattern from I-6, and put a count badge in the inventory nav.
- Staleness guard: if the last full count is older than a threshold (default 14 days, org-configurable later — hardcode a constant for now), show the alert with a "data is stale — count recommended" warning instead of silently trusting the number.

## Part 4 — Smart Cart → draft POs

The payoff feature (BevSpot's Cart Builder + Smart Cart):

- `/inventory/orders/new` cart builder: active ingredients grouped **by vendor** (default; also All/Category). Ingredients with no vendor group under **"No vendor"** and cannot be added to a communicated order — offer inline "assign vendor" like BevSpot does, reusing `VendorIngredient`.
- Each row shows an inventory basis the user can toggle: **Latest finalized count / Expected inventory**, plus ordering guides: **weekly usage** and **par**. Quantity entry toggles between purchase unit (case) and reporting unit.
- **Smart Cart button** with two fill modes:
  1. **Fill to par** — for every ingredient with a par at this store: `orderQty = max(0, par − expected)`, rounded up to whole purchase units.
  2. **Fill to N× weekly usage** — user picks N (default 2): `orderQty = max(0, N × avgWeeklyUsage − expected)`, rounded up.
  Autofill is a starting point; user adjusts before creating.
- "Create orders" converts the cart into **one DRAFT `PurchaseOrder` per vendor** using the existing PO machinery — from there the existing submit/receive lifecycle takes over (this is BevSpot's "Record Order" path; emailing reps is out of scope for I-7).
- Vendor guardrails on the cart review step (see Part 5): warn (don't block) when a vendor's minimums aren't met; default `expectedAt` from vendor delivery days.

## Part 5 — Vendor enhancements (from BevSpot's My Vendors)

Extend `Vendor`:

- `minOrderCases Float?`, `minOrderDollars Float?` — cart review shows a BevSpot-style "minimum not met" warning when a draft PO for that vendor is under threshold.
- `deliveryDays Json?` (array of weekday ints) — when a PO is created/submitted, default `expectedAt` to the next configured delivery day (fall back to `leadTimeDays`, then next weekday).
- `VendorAdjustment` model: recurring invoice-level adjustments (name, type flat/percent, value, GL code/category, active). Auto-attach active ones as editable adjustment lines when receiving that vendor's PO, and include them in COGS GL breakdowns the way I-5 categorizes spend. (BevSpot: adjustments appear on every order record for that vendor and must carry a category.)
- Vendor edit UI: add these fields to the existing vendors page, same form patterns.

## Part 6 — Order history polish

The PO list already exists — bring it to parity with BevSpot's Order History where cheap:

- Group/filter by week, month, or inventory period; totals per group; CSV export following the existing CSV export pattern from the COGS report.
- Invoice attachment on a PO: `invoiceFileUrl String?` + upload on the receive screen (follow whatever file/photo handling already exists; if none exists, store via the same approach used elsewhere in the app or defer with a TODO and note it in the roadmap entry).
- Receiving already updates costs — make sure the "price changed, update going forward?" confirm from BevSpot's Confirming Deliveries flow exists when a received unit cost differs from `VendorIngredient.casePrice`; on confirm, update `VendorIngredient` and write an `IngredientCostLog` entry (I-1b machinery).

## Sequencing, verification, hygiene

1. Build in order: Part 1 → 2 → 3 → 4 → 5 → 6. Commit per part with clear messages.
2. Migrations via `npx prisma migrate dev`; keep schema forward-compatible conventions.
3. After each part: `next build` must pass, lint clean.
4. Extend `scripts/seed-razz-fixture.ts` (or add a sibling seed) so alerts and Smart Cart are demoable: pars on ~10 ingredients, one below reorder point, one vendor with minimums + delivery days + a standing adjustment.
5. End-to-end smoke test before finishing: seed → expected report shows sane quantities → alert fires → Smart Cart fill-to-par builds a draft PO with correct rounded quantities → receive it → alert clears on next expected calc.
6. Update `ROADMAP.md` I-7 row (✅, commit hash, one-line notes) and note anything deferred.

Ask me before making product decisions not covered here; flag any Square API limitations you hit.

---

## Reference: BevSpot behavior notes (source articles)

Condensed from BevSpot's help docs — the third-party platform Froot is modeled on.

**Expected Inventory** (`bevspot.elevio.help/en/articles/266-expected-inventory`) — Perpetual inventory: starting from the last finalized count, auto-deplete via sales/transfers and add deliveries. Report is run "as of last finalized inventory." Works in degraded mode without POS data (orders + transfers only). Feeds the Cart Builder's Inventory column via a toggle (Latest Finalized ↔ Expected).

**Placing Orders / Cart Builder** (`/48-placing-orders`) — Cart groups active items by vendor (also All/Category/Subcategory). Items without a vendor group under "Other" and can't be ordered; inline vendor assignment offered. Per-row: cart icon to add, quantity, case/unit toggle. Two guide toggles: inventory basis (Latest Finalized / Current Draft / Expected) and ordering basis (Weekly Usage / Par Levels). Cart review page → "Place New Order" (communicates to reps) vs "Record Order" (saves only). Multi-vendor orders built simultaneously, split per vendor.

**Smart Cart** (`/50-smart-cart`) — One-click autofill once pars are set or one full inventory cycle exists. "Fill cart to pars" or "Fill cart to 2× weekly usage" (N configurable). Fills based on current draft / latest finalized / expected inventory. User reviews and adjusts before sending. Tip: order to usage for a few weeks to discover pars.

**Order History** (`/298-order-history`) — All order records; group by week/month/inventory period with totals; Excel export for date ranges; per-record export/delete; "Record Invoice" entry point for after-the-fact orders.

**My Vendors** (`/70-my-vendors`) — Vendor records with reps (name + email required to communicate orders; optional SMS). Minimum order thresholds (cases and/or dollars) → warning when an order is under. Delivery days → default delivery date for new orders. Vendors creatable inline from item cards.

**Recording Orders** (`/49-recording-orders`) — Record (don't send) an order from cart review, or create a record from Order History with invoice in hand, adding items line by line. Recorded orders confirm/receive like communicated ones. Keeps usage math accurate for orders placed outside the system.

**Confirming Deliveries** (`/43-confirming-deliveries`) — On delivery: match quantities/prices/deposits/adjustments to the physical invoice, enter invoice #, attach photo/PDF, set delivery date, Mark Delivered. If a price or vendor changed, prompt: adopt new values going forward or keep originals.

**Invoice Upload** (`/46-invoice-upload`) — Attach a file or phone photo to an order record; shown side-by-side with order detail. (Attachment only — OCR/processing is a separate feature, out of scope.)

**Vendor Adjustments** (`/338-vendor-adjustments`) — Standing per-vendor invoice adjustments (fees, deposits, credits) auto-included on every order record for that vendor; each must carry an expense category so the whole invoice categorizes cleanly for finance.
