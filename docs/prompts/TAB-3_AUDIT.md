# TAB-3 — Phase 1 audit (read-only)

**TIER 3.** Written 2026-11-10 by the TAB-3 session, before any build. Nothing in
the tree was changed apart from this file, and no migration was generated.

## 0. Repo gate — PASS

- Working directory and `git rev-parse --show-toplevel` are both
  `/Users/garythomas/Claude_Projects/Froot/froot`.
- Branch `staging`, even with `origin/staging` after a `git fetch`. The only
  untracked file is `docs/prompts/TAB-3.md`, which is left unstaged.
- `git merge-base --is-ancestor 1487091 origin/staging` → true, so TAB-2b's
  PRE-PUSH-CHECK commit is on origin.

```
1487091 docs(TAB-2b) PRE-PUSH-CHECK: rider ratified, prompt of record, DEPLOY_LOG entry, status -> staging
318af62 fix(TAB-2b): rail Help always visible in Tablet mode, /help fallback (Gary's ruling on call b; fixes 007dfd0)
0e9768c docs(TAB-2b): row in_progress (007dfd0), DECISIONS DRAFT rider on TAB-2
007dfd0 TAB-2b: no floating help button in Tablet mode; Help moves to the rail
57a879a docs(TAB-2) PRE-PUSH-CHECK: entry ratified, prompt of record, DEPLOY_LOG entry, status -> staging
```

ROADMAP check: the TAB-3 row (`docs/ROADMAP.yaml:25311`) is `planned`. Its
notes carry TAB-2's rider moving the stat strip here. It has no `blockers` and
no `deferred` field.

**Design reference.** The PDF could not be rendered as images (no poppler on
this machine). Its text was extracted with PDFKit. Pages 12 and 13 are the two
Settings artboards. Pages 1–3 and 11 show the strip as
`SALES TODAY $1,431 ▲ 42.9% | NOVEMBER GOAL 41% | LABOR 16.6% target 20%`.
Where the artboards differ from the code, they are noted below. They are the
reference for list style only, per the prompt.

---

## 1. Desktop card inventory

Source: `src/app/(app)/dashboard/page.tsx` (server) and `dashboard-client.tsx`
(client), read at `1487091`. Every card is a **self-fetching client component**
except Monthly Goal, Shift Checklist and the comms trio, which share two
fetches owned by `DashboardClient`.

### 1a. Above `DashboardClient` (page.tsx) — banners, not cards

| # | Proposed key | Component | Width | Data | Gate today |
|---|---|---|---|---|---|
| B1 | `compliance-banner` | `ComplianceBanner` (`compliance-banner.tsx`) | full | `GET /api/dashboard/my-compliance` | Renders nothing unless this person owes training (SELF-1) |
| B2 | `overdue-alerts` | `CalendarDueBanner` (`src/components/calendar-due-banner.tsx`) | full | `GET /api/calendar/due` | Renders nothing when nothing is due (CAL-1) |

**Lean: neither banner goes in the layout** (see Fork F1). Both are
obligations, not dashboard content. SELF-1's comment says it sits above
everything "because a manager's own overdue training should not be below three
sales cards". The design's Dashboard tab does list "Overdue alerts" as a row,
which is why this is a fork and not a silent call.

### 1b. Single-store view (`DashboardClient`, the `!isRollup` branch), in render order

Today the cards are arranged in **four hard-coded flex-wrap rows** plus a
trailing section. Width is a flex share inside its row, not a grid span. In the
column below, "span" is the share each card takes of a 3-unit row. That is what
the packing proposal in § 8 uses.

| # | Proposed key | Component (file) | Wrapper class today | Span | Data | Gate that hides it today |
|---|---|---|---|---|---|---|
| 1 | `sales-performance` | `SalesPerformanceCard` (`sales-performance-card.tsx`) | `flex-[2] min-w-[320px] md:min-w-[420px]` | 2 | `GET /api/dashboard/sales?storeId&start&end&compare` (own fetch, range from sessionStorage, default "today" vs same weekday last year) | Store scope only (route 403s unassigned stores). **No capability.** Without Inventory module + Square link it still renders a "Connect Square to see sales" state. The labor % inside it is gated by `laborVisible` (key absent). |
| 2 | `monthly-goal` | `MonthlyGoalCard` (in `dashboard-client.tsx`) | `flex-1 min-w-[260px]` | 1 | `GET /api/dashboard/summary?storeId` (shared with #7). Goal save is `PUT /api/dashboard/goal`. | Store scope only. The Edit/Set button is `dashboard.goal.edit`, the "Forecasting →" link is `forecasting.view`, and the labor line is `laborVisible`. The card itself always renders. |
| 3 | `labor-coverage` | `LaborCoverageCard` (`labor-coverage-card.tsx`) | `flex-[2] min-w-[320px] md:min-w-[420px]` | 2 | `GET /api/labor/coverage?storeId&date`. The clocked-in roster and day-adjustment are sub-calls. | **`laborEnabled`** = `laborModuleAvailable(orgId) && activeModules.includes("labor")` (page.tsx). The route's `requireLaborView` repeats it. The schedule overlay inside is `labor.schedule.view` (key absent). |
| 4 | `labor-budget` | `LaborBudgetCard` (`labor-budget-card.tsx`) | `flex-1 min-w-[260px]` | 1 | `GET /api/labor/budget?storeId&weekStart` | Same `laborEnabled` gate as #3. |
| 5 | `team-messages` | `TeamMessagesCard` (in `dashboard-client.tsx`) | `flex-1 min-w-[280px]` | 1 | `GET /api/dashboard/comms?storeId` (shared with #6 and #7a) | Store scope only. On a comms failure it carries the single Retry. |
| 6 | `corporate-update` | `CorporateUpdateCard` | `flex-1 min-w-[280px]`, **wrapper rendered only when `commsLoading \|\| comms.corporateUpdate`** | 1 | comms (shared) | Store scope. **Collapses entirely when no update is active.** This is a runtime collapse, not a gate. |
| 7a | (rides with 7, Fork F2) | `ShiftNotesCard` | stacked **inside** #7's column (`space-y-4`) | 0 | comms `shiftNotes` (shared). Acknowledge is `PATCH /api/messages/[id]`. | Returns `null` when no unacknowledged notes |
| 7 | `shift-checklist` | `ShiftChecklistCard` | column `flex-1 min-w-[280px] space-y-4` | 1 | summary `checklist` (shared with #2) | Store scope only |
| 8 | `instagram` | `InstagramStrip` | full width, **not inside a flex row** | 3 | `GET /api/instagram/feed?limit=12` (served from server cache) | Self-hides unless connected, `instagramEnabled`, and at least one post |

### 1c. Rendered in both modes (outside the `isRollup` branch)

| # | Proposed key | Component | Width | Data | Gate today |
|---|---|---|---|---|---|
| 9 | `inventory-count` | inline "Days since last inventory count" section (heading plus one tile per store) | full | Server query in `page.tsx` (`countRecency`) | `inventory.analytics.view` (MANAGE tier) **and** `activeModules.includes("inventory")`. Empty array → not rendered. |

### 1d. All-locations mode

`RollupView` (`rollup-view.tsx`, `GET /api/dashboard/rollup`) **replaces**
cards 1–8 when the store selector is on "All locations". It is one composite
view, not a card. **Lean: the layout does not touch rollup** (Fork F3). Only
`inventory-count`, which already renders below the rollup today, follows its
toggle in both modes.

### 1e. Not cards

- The page header is not a card: the h1, the date line, the NAV-1 "Daily Tasks"
  button and the store selector.
- `BuildInfo` is not a card.

### 1f. Layouts that would break if a card moved

1. **Sales Performance and Monthly Goal** (2 + 1) and **Labor Coverage and Labor
   Budget** (2 + 1) are deliberate pairs. The labor row's comment says Coverage
   sits *directly beneath Sales* so the two hourly axes align, and Budget sits
   beneath Goal. Moving any one of the four loses that alignment. Nothing
   crashes; it is purely visual. The same comment records the earlier bug
   where nesting the labor cards inside the sales columns hid them. The
   packing model in § 8 never nests, so that bug cannot recur.
2. **Shift Notes is stacked inside the Shift Checklist column.** It is not a
   sibling. Giving it its own position changes the default render (Fork F2).
3. **The comms row relies on Corporate Update collapsing.** With no active
   update, today's row is Messages + Checklist at 50/50. Any model must keep a
   runtime-null card from leaving a hole, and must reproduce that 50/50.
4. **Instagram and Days-since-count are full-width blocks outside any row.**
   Moving them among the span-1 cards must not put them in a shared row.

**A naive single flex-wrap container would break the null-layout guarantee.**
In one container, Sales (min 420) + Goal (min 260) + Coverage (min 420) fit on
one line on a wide desktop. That is not today's render. § 8 proposes explicit
row packing.

---

## 2. Tablet tiles

**All three tiles can come from ONE existing endpoint,
`GET /api/dashboard/summary?storeId=`.** No new endpoint is needed, so there is
no STOP item.

| Tile key | Figure | Field | Matches desktop | Gate |
|---|---|---|---|---|
| `sales` | Today's net sales, plus ▲/▼ % vs same weekday last year | `sales.today.total` and `sales.lastYear.total` | Sales Performance's default "Today so far" headline and its DeltaPill. **Both read `SalesPeriodCache.netSales` for today's row**: the summary route at `summary/route.ts:141`, the sales route's `net` at `sales/route.ts:91`. Delta formula as in `DeltaPill` (`sales-performance-card.tsx:508`): `(today − ly) / ly × 100`, hidden when `ly ≤ 0`. | Store scope (route 403). `salesAvailable` (Inventory module + `store.squareLocationId` + org Square token). **No capability gate on desktop**, so none here. |
| `monthly-goal` | "% of goal" | `goal.monthToDate / goal.goalAmount`, capped at 100% | Monthly Goal card's `pctOfGoal` line (`dashboard-client.tsx:541`, `:612`). The label uses the same month name. | Store scope. `goal.goalAmount === null` is a state, not a gate (see the fork below). |
| `labor-pct` | MTD labor %, plus "target N%" and the green/red verdict | `labor` (a `LaborBlock`: `laborPct`, `target`, `health`) | Monthly Goal card's "<Month> labor %" line (`LaborPctLine`, `dashboard-client.tsx:634`) | `laborVisible(org, actor)` = `laborModuleAvailable` + `activeModules` "labor" + `squareLaborAvailable` + `org.squareLaborEnabled` + **`can(actor, "labor.actuals.view")`**. When any one is off, **the `labor` key is absent from the payload**, so the tile has nothing to render. This is the AL-2 "absent, not empty" rule. |

### Tile behaviour proposals (judgement calls, flagged)

- **Sales tile when `salesAvailable` is false: hide the tile.** Desktop shows a
  "Connect Square" card there instead, but a hint tile in a slim crew strip is
  noise. The alternative is a compact "Connect Square" tile.
- **Goal tile when `goalAmount` is null: show "No goal set".** This keeps the
  strip's shape stable, and it matches desktop, which still renders the card.
- **The strip disappears** when no tile is enabled **or** none survives its
  gate for this viewer. If an ADMIN enabled only Labor % and Tommy lacks
  `labor.actuals.view`, the strip does not render for Tommy. That is staging
  test 5.

### Fork F4 — which labor figure

- **Lean: MTD**, from the summary payload, matching the Monthly Goal card. One
  fetch serves all three tiles.
- The design's tablet-tab copy says "Today's labor vs the 20% target", and the
  desktop Sales Performance card's labor metric defaults to *today*. Choosing
  "today" means a second call per refresh,
  `GET /api/dashboard/sales?storeId&start=today&end=today&compare=…`, which
  already carries a today-window `labor` block under the same `laborVisible`
  gate. That is still no new endpoint.
- The design strip itself just says "LABOR 16.6% target 20%".

### Cost note on the refresh cadence (COMMENT)

The strip re-reads summary every 60 s while the tablet is visible (§ 6 ruling,
TAB-2 ruling 8). Each read does the following:

- reads the sales caches
- runs `ensureSalesCached` for the month and comparison day (no-ops once cached)
- builds the checklist block, which the strip doesn't need
- schedules a Square sales refresh in `after()` **only when today's cache is
  older than `STALE_MS`, 15 min** (`summary/route.ts:26`)
- schedules the labor refreshes, which have their own 15-min cooldown
  (`labor-dashboard.ts`)

So an open tablet costs at most about one Square sales sync per 15 min per
store. That is the cadence desktop already allows on reload. The summary
route's BUG-6 `salesRefreshing` poll is not needed by the strip, because the
60 s timer supersedes it.

---

## 3. Settings sub-page pattern

The precedent is written into `src/app/(app)/settings/notifications/page.tsx`'s
header comment, which says its shape was copied from `/settings/labor`:

- **Layout.** There is no `layout.tsx` anywhere under `settings/`; the chrome is
  the `(app)` shell. Each page has a `ChevronLeft` back-link to `/settings`, an
  h1, one line of description, then cards.
- **Page gate (notifications — the one TAB-3 copies).** `getCurrentUser()`
  wrapped in try → `redirect("/dashboard")`. Then
  `if (!can(actor, "settings.access")) redirect("/dashboard")`.
  `settings.access` is `ADMIN_ONLY` (`src/lib/permissions.ts:302`) and is held
  out of the override grid, so it cannot be granted down. `/settings/labor` is
  the counter-example: it gates on `labor.manage && labor.access`
  (ADMIN + MANAGER) behind the module gates, which is not what ruling 1 wants.
- **Save route shape.** The exemplar is `PUT /api/pace-alerts/settings`
  (`src/app/api/pace-alerts/settings/route.ts`):
  1. `auth()` orgId → 401
  2. `requireAdmin()` in try/catch → 403 `"Admin access required"`. This is
     **the inline re-check, per PERM-2: "a gate on a page is not a gate on an
     endpoint"**.
  3. Zod `safeParse` → 400 with the first issue's message
  4. org lookup by `clerkOrgId` → 404
  5. `prisma.organization.update`
  6. Return the updated fields.

  The client island does a `fetch` PUT, then `router.refresh()`.
  `PUT /api/hr/settings` follows the same gate.
- **Link card on `/settings`.** `src/app/(app)/settings/page.tsx` has Tabs
  `integrations | organization | billing`. The Message Center card is under the
  `integrations` tab (`page.tsx:423–450`): a `Card` holding a single `Link` row
  with an icon tile, a title and a description on the left, and
  "… Settings →" on the right. **It deliberately shows no state on the link
  card** (its own comment explains why), and the Display card should copy that.
  The page itself is already `settings.access`-gated (`page.tsx:51`).

### Proposed for TAB-3

- **Page.** `/settings/display/page.tsx`, a server component with the
  notifications gate verbatim. It resolves both layouts through the pure module
  and hands them to `display-settings-client.tsx`. The client has two `Tabs`
  (Dashboard, Tablet), using the existing `@/components/ui/tabs`.
- **Rows.** Each row has a `Switch` (`@/components/ui/switch`), 44 px+ up/down
  buttons, and a dnd-kit handle (§ 7). Locked rows show a lock and "Locked on".
- **Reset.** Each tab's "Reset to defaults" uses `AlertDialog`, as § Design
  System requires for destructive actions.
- **Save route.** `PUT /api/display/settings` with body
  `{ surface: "dashboard" | "tablet", layout: [{ key, enabled }] | null }`,
  where `null` is the reset. One route serves both tabs. The name follows
  `/api/pace-alerts/settings`.
- **Link card.** One link card, "Display Settings →", under the `integrations`
  tab next to Message Center. A new "Display" tab on `/settings` is the
  alternative (Fork F7). Lean: the card, because it matches how Notifications
  was added.

---

## 4. Organization model and proposed schema

`model Organization` (`prisma/schema.prisma`) scalar fields today:

- `id`, `clerkOrgId`, `name`, `slug?`, `timezone`, `createdAt`
- `squareCustomerId?`, `squareSubscriptionId?`, `subscriptionStatus?`,
  `activeModules String[]`
- `squareAccessToken?`, `squareRefreshToken?`, `squareTokenExpiresAt?`,
  `lastCatalogSyncAt?`
- `instagramAccessToken?`, `instagramTokenExpiresAt?`, `instagramUserId?`,
  `instagramUsername?`, `instagramEnabled`, `instagramConnectedAt?`
- `squareLaborEnabled`, `calendarEnabled`, `milestonesEnabled`,
  `paceAlertsEnabled`, `paceAlertThresholdPct Int?`, `milestoneAlertsEnabled`,
  `docDigestEnabled`
- `handoffNoteExpireDays`, `hrDateStampFormat`, `hrAckRecipients String[]`
- `nutritionServingFlOz Float?`

There are no JSON columns on Organization yet. `Json?` has precedent elsewhere
in the schema: `sectionsSnapshot`, `deliveryDays`, `definitionSnapshot`,
`options`.

**Proposed (the lean holds):**

```prisma
  // TAB-3 — ADMIN's card picker. Ordered [{ key, enabled }]. NULL = Froot's
  // defaults (src/lib/display-layout.ts); "Reset to defaults" writes NULL.
  dashboardLayout Json?
  tabletLayout    Json?
```

The expected SQL is two `ALTER TABLE "Organization" ADD COLUMN … JSONB`, with
no default and no backfill. It is additive only.

**Why JSON and not a table:**

- The layout is always read and written whole, by one org, on one row the
  dashboard page **already loads** (`page.tsx` `findUnique` on Organization).
  That means zero extra queries on the hot path.
- Its shape is owned by a code registry, not by relational integrity. Keys are
  validated by the route and normalised by the merge on every read.
- A `DisplayLayoutEntry` table would cost a join or a second query on every
  dashboard load, plus a delete-and-reinsert transaction on every save, and
  buy nothing.
- Per-store layouts (deferred, TAB-1 ruling 3) would be the point to revisit.

**Hazard (COMMENT): this is the NOTIFY-2a shape.** Every
`prisma.organization.findUnique/findFirst` without a `select` reads the new
columns. Until Gary applies the migration to dev, every dev page and every
fixture that loads an org fails. The migration STOP rule already covers it;
it's named here so the wait is expected.

---

## 5. Merge rule for saved layouts (`resolveLayout(surface, saved)`)

The lean holds, with one addition (position of locked keys):

1. `saved` is null, not an array, or fails to parse → return the registry
   defaults (default order, default `enabled`).
2. Walk `saved` in order. Keep the first occurrence of each **known** key with
   its `enabled`. **Drop** unknown keys and duplicates. A non-boolean `enabled`
   falls back to the key's default.
3. **New keys.** A registry key absent from `saved` is inserted at its default
   position: directly after the nearest preceding key (in default order) that
   is present in the merged list, or at the start if there is none. It takes
   its default `enabled` (desktop cards on, tablet tiles off).
4. **Locked keys (tablet `tasks`, `messages`).** These are forced
   `enabled: true` **and pinned to the front in registry order**. Ruling 4
   fixes them as the two columns, so their position is not data.
5. Output is a total, ordered list of every registry key for that surface.
   Renderers filter it by `enabled` and then by per-viewer gates.

---

## 6. Validation (`PUT /api/display/settings`)

1. Signed in with an org → 401 otherwise. **`requireAdmin()` → 403**, the
   inline re-check, even though the page is `settings.access`-gated.
2. Zod: `surface` is `"dashboard" | "tablet"`, and `layout` is either `null`
   (reset) or an array of `{ key: string, enabled: boolean }`, strict.
3. **Known keys only.** Any key not in that surface's registry → 400. The save
   path is stricter than the read path on purpose: the merge forgives old data,
   the route refuses new bad data.
4. **No duplicates, and every key for the surface exactly once.** The UI always
   sends the full list. A partial list → 400, so a save can never rely on the
   merge to guess (lean; Fork F5).
5. **Dashboard: at least one entry `enabled`** → 400
   "Keep at least one card on." This counts against the registry, not the
   org's modules (Fork F6).
6. **Tablet: `tasks` and `messages` must be `enabled: true`** → 400 otherwise.
   Their array position is ignored and normalised by the merge.
7. Write the **normalised** result (the merge output, not the raw body), or
   `Prisma.DbNull` for a reset. Return the resolved layout.

The fixture covers rules 1, 3, 5 and 6 as pure functions, plus the 403 path.
The route will call one exported `validateLayout(surface, body)` so the fixture
exercises the same code the route does.

---

## 7. Drag and drop — a library IS already a dependency

- `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0` and
  `@dnd-kit/utilities ^3.2.2` are in `package.json` and installed.
- Live users: `templates/template-form.tsx` (the most complete: `DndContext`,
  `SortableContext`, `useSortable`, `arrayMove`, `GripVertical` handle,
  `PointerSensor` with `activationConstraint: { distance: 8 }`),
  `hr/training/training-form.tsx`, `hr/training/training-client.tsx`, and
  `inventory/storage-areas/by-area-view.tsx`.

Per ruling 6, TAB-3 adds **both** the touch-size up/down arrows **and** dnd-kit
drag handles, copying template-form's pattern. Locked tablet rows are not
draggable. COMMENT: a touch-drag handle needs `touch-action: none`
(`touch-none`) on the handle, or iPad Safari scrolls instead of dragging. The
arrows remain the accessible path.

---

## 8. Desktop render path — where order is decided today, and the smallest change

**Today** the order is fixed by JSX, `dashboard-client.tsx:319–418`:

1. sales row `div.flex.flex-wrap.gap-4` [Sales, Goal]
2. `laborEnabled &&` labor row [Coverage, Budget]
3. comms row [Messages, Corporate?, column(ShiftNotes, Checklist)]
4. bare `<InstagramStrip/>`
5. after the rollup/single ternary, the `countRecency.length > 0` section

### Proposal: greedy row packing driven by the registry

- In the registry, each desktop card carries its **span** (2, 1 or 3 = full),
  its **wrapper className copied verbatim** from today's JSX, and a renderer.
- **Server (`page.tsx`):**
  `resolveLayout("dashboard", org.dashboardLayout)` → ordered enabled keys.
  Pass them to `DashboardClient` as one new prop. `org` is already loaded.
- **Client (`DashboardClient`):**
  1. Filter out cards the viewer cannot get: `laborEnabled` for
     coverage/budget, and `countRecency.length > 0` for inventory-count. These
     are the gates that exist today, unchanged.
  2. Pack greedily into rows of capacity 3. A card that doesn't fit the
     remaining capacity starts a new row.
  3. Full-width items render bare, outside any row, as Instagram and the count
     section do today.
  4. Span-1/2 rows render as `div.flex.flex-wrap.gap-4` containing each card's
     own wrapper.
- **Runtime-null cards** occupy their slot in the packing but render nothing,
  exactly as today. The Corporate wrapper keeps its
  `commsLoading || corporateUpdate` condition, so a row with no active update
  reflows to 50/50 as it does now.
- **Rollup mode is unchanged.** `RollupView`, then `inventory-count` if it is
  enabled.

**Why null renders exactly as today.** Packing the default order with today's
gates reproduces today's rows one for one:

| Row | Contents | Units |
|---|---|---|
| 1 | Sales + Goal | 3 |
| 2 | Coverage + Budget, only when `laborEnabled` | 3 |
| 3 | Messages + Corporate + Checklist | 3 |
| 4 | Instagram, bare | full |
| 5 | count section | full |

Each card's wrapper class is today's string. The fixture asserts
`pack(resolveLayout(null))` equals that row grouping, both with and without
labor. The temporary local page compares the DOM.

**What a reorder does.** Cards flow in the chosen order and keep their widths.
A span-2 card alone in a row grows to fill it (the flex share), which is the
natural flow the ruling asks for. The Sales/Coverage axis alignment (§ 1f.1)
holds only when the admin keeps that order. A live preview ROW would let them
see it before saving.

**Shift Notes (Fork F2).**

- **Lean:** notes keep riding inside the `shift-checklist` slot (stacked above
  it), with no key of their own. The slot renders `ShiftNotesCard` +
  `ShiftChecklistCard` as today.
- Consequence: turning Shift Checklist off also hides unacknowledged handoff
  notes on the desktop dashboard. They remain on `/messages` and on the tablet
  thread.
- Alternative: a separate `shift-notes` key with a special rule that "if it
  directly precedes `shift-checklist`, stack them in one slot". That is more
  flexible but adds a packing special case.

---

## Forks — leans for Gary's ruling

| # | Fork | Lean | Alternative |
|---|---|---|---|
| F1 | Banners (`ComplianceBanner`, `CalendarDueBanner` = the design's "Overdue alerts") in the Dashboard tab? | **No.** They stay pinned above the cards and are not toggleable. They are personal and store obligations, and hiding them org-wide hides overdue training and reminders. | Add `overdue-alerts` as a toggle row (the design lists it), leaving compliance pinned. |
| F2 | Shift Notes | **Rides inside the `shift-checklist` slot**, no own key | Own key plus a stacking special case |
| F3 | All-locations rollup | **Untouched by the layout.** Only `inventory-count` follows its toggle in both modes. | Apply the layout to rollup too (it has no matching cards, so this would mean new work) |
| F4 | Labor % tile figure | **Month-to-date** from `/api/dashboard/summary`: one fetch, matches the Monthly Goal card | **Today**, matching the design copy and the Sales card default, at the cost of a second fetch to `/api/dashboard/sales` |
| F5 | Save body completeness | **Full list required**, each key exactly once | Accept partial lists and merge |
| F6 | "At least one desktop card on" | **Counted against the registry** | Counted against cards this org's modules allow. Example: only Labor Coverage on, in an org without Labor, gives an empty dashboard. |
| F7 | Where the `/settings` link card goes | **Integrations tab**, next to Message Center | A new "Display" tab |
| F8 | Sales tile with no Square link | **Hide the tile** | A compact "Connect Square" tile |
| F9 | Goal tile with no goal | **Show "No goal set"** | Hide the tile |

## Smaller notes (COMMENT; no ruling needed unless Gary wants one)

- **Design vs code, desktop.** The design's Dashboard list orders the cards
  Sales, Labor budget, Monthly goal, Labor coverage, and so on, and omits
  Instagram and Inventory count. The registry defaults to **today's code
  order**, because ruling 2 says that nothing changes until an ADMIN edits.
- **Design vs ruling, tablet.** The design's tablet tab heads the tiles "BOTTOM
  ROW · FIRST 3 THAT ARE ON" and also lists Labor budget and Inventory count.
  Ruling 4 limits the optional tiles to Sales, Monthly Goal and Labor %, so
  those two aren't offered.
- **Design copy vs ruling 2, footer.** The Dashboard artboard's footer says
  changes "apply to everyone at this store". Ruling 2 is one layout **per
  org**, so the page copy should say "everyone in your organization".
- **Today's date: browser vs store zone.** The Sales card resolves "today" in
  the browser's zone (`resolvePreset`), while the summary route uses the
  store's zone. They differ only when a device's zone differs from the store's.
  This is pre-existing and not introduced here.
- **No new capability.** Tiles reuse the gates the desktop already asks, by
  reading the same payload. TAB-3 adds no entry to `permissions.ts`.

## Findings triage (Phase 1)

- **FIX NOW: 0.** Nothing is broken today.
- **RULING NOW: 9.** Forks F1–F9 above.
- **COMMENT: 6.**
  - the refresh-cadence cost (§ 2)
  - the NOTIFY-2a-shaped wait (§ 4)
  - `touch-none` on drag handles (§ 7)
  - design-vs-code order
  - "per org" page copy
  - browser-vs-store "today"
- **ROW: 0 new now.** The live-preview ROW is filed in Phase 2 per ruling 8.

**STOP.** Nothing has been built and no migration has been generated. Waiting
for Gary's rulings on F1–F9 and the go.
