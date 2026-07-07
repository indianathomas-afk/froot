# Froot — Phase Roadmap & Status

> **Single source of truth for build status.** At the end of every phase, update this table
> (status, commit hash, notes) and commit it along with the phase's code.
> Last updated: 2026-07-06

| Order | Phase | Size | Status |
|---|---|---|---|
| 1 | I-1 Sales item sync + Ingredient library | M–L | ✅ Done (7-4/7-5, v2 rebuild: SalesItem vs Ingredient split, units.ts, CSV import) |
| 1b | I-1b Ingredient parity, lifecycle & duplicates | M | ✅ Done 7-6 (lifecycle, bulk edit, duplicate finder, cost log) |
| 2 | I-2 Vendors, POs & Receiving | M–L | ✅ Done (full PO lifecycle, receiving updates costs; receipts stamp receivedAt so purchases land in the right inventory period) |
| 3 | I-3 Storage areas | S–M | ✅ Done (commit 432a30e) — areas + count sheets, bulk assignment, unassigned triage, re-pointed to ingredientId |
| 4 | I-4 Physical counts | M | ✅ Done (commit eb816db) — count workflow, weigh-to-count, offline-tolerant entry, finalize, corrections + audit trail, count summary |
| 5 | I-5 Sales sync + COGS & analytics | M–L | ✅ Done 7-6 (b3cb378) — Square sales sync (daily/hourly/per-item caches), inventory-period math, Reports suite under Inventory: Summary, Item Sales, Periods/COGS with GL breakdown + negative-usage flags, Valuation, Turnover, Vendor Spend |
| — | D-1 Dashboard redesign (added in pack v2.3) | M | ✅ Done 7-6 (1b8160f) — Sales Performance (today vs same weekday last year, hourly pace), Monthly Goal with extrapolation, real Shift Checklist, mock-backed Team Messages / Corporate Update / Instagram |
| 6 | I-6 Recipes + needs-attention queue + adjustments | L | ⬜ **Next up** — also adds Variance + Profitability tabs to the reports suite |
| 7 | I-7 Reorder points & alerts | M | ⬜ Not started |
| 8 | M-1 Keva data migration (optional) | M | ⬜ Best after I-6 |
| 9–11 | N-1/N-2/N-3 Nutrition | M | ⬜ Not started |
| 12 | X-1 Activation & QA | S | ⬜ Not started |
