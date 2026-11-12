# TAB-14 — Gate 0 preflight and Gate 1 audit

Session: 2026-11-11. TIER 2. Prompt of record: `docs/prompts/TAB-14.md`
(untracked until PRE-PUSH-CHECK). Read-only: no code written, nothing
committed. Design source: "Froot Tablet — Checklists" PDF (5 pages; read
pages 1–3 only: "Checklists · Tablet landscape", "Checklists · Tablet
portrait (with store-only overdue alert)", "Checklist type key"; pages 4–5
are the Home boards and were not used).

## Gate 0 — preflight

- **Repo root:** `/Users/garythomas/Claude_Projects/Froot/froot`, branch
  `staging`.
- **SHAs:** local HEAD = `origin/staging` =
  `adc0f9e826369cf1a298867b9e8ab50f4e063e3e`; `origin/main` = `def04fa`.
  Matches the prompt.
- **Tree:** clean except `?? docs/prompts/TAB-14.md` (and this file).
- **Next free TAB id:** TAB-14. Highest in `docs/ROADMAP.yaml` is TAB-13;
  `grep TAB-14` over `docs/ROADMAP.yaml` and `docs/*.md` returns nothing.
- **Read:** TAB-13's DECISIONS entry (`docs/DECISIONS.md:8`, ratified),
  DEBT-130/131/132 (`docs/ROADMAP.yaml:39803`, `:39825`, `:39845`),
  `src/lib/checklist-types.ts`, `src/lib/tablet-today.ts`.
- **Staging-SHA precondition (before the "before" shots):**
  `npx vercel inspect froot-git-staging-indianathomas-2483s-projects.vercel.app`
  → `dpl_ArPc6NZ7jLkB7MFfBtD5TiV6pQZQ`, url `froot-3s3jteimb…`, created
  Wed 2026-11-11 14:10:11 PST. `npx vercel ls --meta
  githubCommitSha=adc0f9e826369cf1a298867b9e8ab50f4e063e3e` → the same
  `froot-3s3jteimb…` deployment. **Match.**
- **"Before" screenshots** — staging · Clerk instance `verified-snapper-7` ·
  org `org_3G02wO4QlVVSWppi8aqlnSZnsDa` ("Keva Juice (staging)") · login
  `user_3GsleYrs6kCTiq4b0Q9h4q6xQxz` (corporate@keva.com, a single-store
  login locked to Las Brisas) · viewport 834×884 (the Chrome window would not
  resize wider, so no landscape-width shot was possible):
  - Tablet `/checklists` (`froot_view=tablet`): red banner "3 items due ·
    3 overdue / 47 days overdue" (Deposit, Test, Test 11-10-26 — all Las
    Brisas, all reminders); "Daily Checklists / Viewing checklists for Las
    Brisas"; three cards titled "Las Brisas": Mid-Shift Not Started,
    Opener Overdue + In Progress, Cleaning Completed; each "View Checklist".
  - Desktop `/checklists` (switched to Desktop, shot, switched back to
    Tablet; cookie re-read as `froot_view=tablet`): same banner, same three
    cards in a 3-column grid, desktop sidebar.
  - Files (not committed):
    `/private/tmp/claude-501/-Users-garythomas--claude-spares-spare-8m1BhN/91db79cb-a399-46ae-9ba3-96209add9af3/scratchpad/before/tablet-checklists-834w-before.jpg`,
    `…/before/desktop-checklists-834w-before.jpg`.

## Gate 1 — audit

### a. Rendering

- `/checklists` is ONE server component, `src/app/(app)/checklists/page.tsx`,
  with **no tablet branch**: it never calls `getViewMode()` (the only callers
  are `(app)/layout.tsx:151`, `dashboard/page.tsx:136`,
  `messages/page.tsx:29`).
- Tablet mode reaches it only through the layout: `(app)/layout.tsx:151-176`
  wraps `children` in `TabletShell` (rail, store name) when the cookie says
  tablet. So the tablet page today IS the desktop page inside the rail — the
  `grid grid-cols-3` of cards at `page.tsx:162`, the `StoreFilter`
  ("All My Stores", `store-filter.tsx:19`) when the login has more than one
  store (`page.tsx:149`), and each card titled with the store name
  (`page.tsx:181`) and the type as a small grey tag (`page.tsx:201-206`).
- Desktop and tablet share the whole page; desktop shares no component with
  tablet Home. The established pattern for a tablet-only page is the
  Messages one: `messages/page.tsx:29` returns a tablet component when
  `getViewMode() === "tablet"`, else the desktop one.

### b. Data — the page's source vs Home's

*What would disprove "Home's list is a superset of today's page, plus
unstarted checklists": a row on `/checklists` whose template is absent from
GET `/api/stores/[id]/templates` for that store, or a row dated before
today.*

- **Page:** `prisma.checklist.findMany` over today's business day per store
  timezone (`page.tsx:85-103`) — **rows only**, every store in scope. No row
  from an earlier day can appear: the `date` window is `businessDayWindow(now,
  tz)` (`page.tsx:88-89`). Missed rows are included by design
  (`page.tsx:39`), but no today row can be Missed (day close's lookback is
  yesterday and the day before — `templates/route.ts:155-162`).
- **Home:** GET `/api/stores/[id]/templates` (`route.ts:15-168`) — every
  active, non-archived, applicable template (`:37-45`, `:78-98`), with
  today's row if one exists (`:55-75`), Missed dropped (`:167`).
- **Home shows, page does not:** a template nobody has started (no row).
  **Observed live** (staging · `org_3G02wO4QlVVSWppi8aqlnSZnsDa` ·
  `verified-snapper-7` · Las Brisas, GET from the page's own session):
  Home's list has FOUR — Closer Checklist (type Closer, no row, `upcoming`,
  28 tasks), Mid-Shift Checklist (row, Pending, `active`), Opener Checklist
  (row, In Progress, `overdue`), Overdue Test (type Cleaning, row,
  Completed). The page shows three; Closer is missing.
- **Page shows, Home does not (code reading; none observed today):**
  1. a today row whose template was deactivated or archived after the row
     was created (`route.ts:38` filters `isActive: true, isArchived: false`;
     the page joins the template with no such filter);
  2. a today row of an `appliesTo: "selected"` template whose assignment to
     this store was removed after the row was created (`route.ts:79-81`
     returns false before the row-exists check).
  On staging today all three page rows are in Home's list, so neither case
  is live. → **RULING NOW 4.**

### c. Store

- Tablet mode's current store is **client-side**, not a server cookie or a
  TAB-1/TAB-4 pin: `localStorage["froot.dashboard.store"]`
  (`src/lib/dashboard-store.ts:10`, read by `useSavedStoreId` `:26-32`),
  resolved by `resolveSingleStore(stores, saved)` (`:45-47`) — the saved id
  if this login can see it, else the first store. Read by tablet Home
  (`tablet-home.tsx:249-251`) and the rail (`tablet-shell.tsx:73-74`); set
  by Home's store Select (`tablet-home.tsx:587`) and Messages
  (`messages-tablet.tsx:35`).
- The store list that resolution runs over matters, because the fallback is
  `stores[0]`: Home uses active stores, name asc, scoped by
  `getUserStoreScope` (`dashboard/page.tsx:34-38`); the rail the same rule
  (`layout.tsx:157-167`). The desktop page's list has **no** `isActive`
  filter (`page.tsx:59-62`), so it must not be reused for this.
- **Live illustration:** in the browser above, the saved id is a store this
  login cannot see (GET `/api/stores/<saved>/templates` → 403), and the rail
  correctly falls back to Las Brisas. Any tablet `/checklists` that read
  localStorage raw would break exactly here.
- **How this page will read it:** a client component calling
  `useSavedStoreId()` + `resolveSingleStore()` over the server-loaded
  Home-scoped store list. No server-side store pin exists to read instead.

### d. Overdue banner

- Component: `CalendarDueBanner` (`src/components/calendar-due-banner.tsx`),
  mounted at `checklists/page.tsx:138` and on desktop `/dashboard`.
- **What it counts:** calendar **occurrences** — reminders, plus CAL-2
  scheduled (non-daily) checklists — never daily checklists. Feed:
  GET `/api/calendar/due` (`api/calendar/due/route.ts`), rows with
  `status: "Open"`, `dueDate <= today` with **no lower bound** (`:48-55`),
  so an unfinished reminder stays forever. "Overdue" is `dueAt <= now`
  (`:93`). The subline "N days overdue" is `maxDaysOverdue` — calendar days
  since the OLDEST open item's due date (`:84-88`, `:99`). Today on staging
  that is "47 days" (Deposit, due 2026-09-25); the prompt's "36" was the same
  figure on an earlier day.
- **Store scope:** the banner calls the feed with no `storeId`
  (`calendar-due-banner.tsx:178`), so it gets every store the actor can see
  (`resolveStoreScope`, `calendar-access.ts:118-126`) and groups them with a
  store strip (`:303`, `:438-459`). That is the "Meadowood Mall 3, Sparks 2"
  on a multi-store login. **The route already accepts `?storeId=`**
  (`due/route.ts:34`; `calendar-access.ts:124-125` narrows to that one store
  or nothing). Verified live: `?storeId=<Las Brisas>` → 3 items, 3 overdue,
  max 47 (same as unscoped, since this login has one store).
- **Home's control — premise correction.** TAB-12 is "Tablet home — choose
  a message type" (`ROADMAP.yaml:26529`); it built no overdue control. Home's
  "N overdue" chip is TAB-1's, its rule moved to `src/lib/tablet-due.ts` by
  TAB-1c, and it opens in place since TAB-9 (`tablet-home.tsx:557`,
  `:610-628`). It reads the **same feed** (`tablet-home.tsx:305`) and keeps
  this store's items client-side (`tablet-due.ts:42-47`), overdue by the
  same `dueAt <= now` (`tablet-due.ts:30-32`). **Both count the same thing**,
  so this is not a RULING NOW under R8.
- Its actions: Complete (POST `/api/calendar/occurrences/[id]/complete`,
  PIN flow when required, `:214-278`) or "Open checklist" link for a
  template-backed item (`:497-509`). No "Finish it" exists anywhere.

### e. Buttons

- Today: every card's only button is "View Checklist" →
  `/store-view/checklist/${checklist.id}` (`page.tsx:213-218`). Confirmed.
- Home's create-run is `start()` at **`tablet-home.tsx:1000`** (the prompt's
  `:957` is inside `toggle()`): with a row → open it in the card; without →
  POST `/api/checklists {templateId, storeId}` (`:1013-1017`), 403 → "This
  login can't start a checklist…", other errors → the route's message, then
  open in the card and re-read. It **ignores the returned id** and never
  navigates (RN-1).
- POST `/api/checklists` returns `{ id }` — 201 new, 200 if today's row
  already exists (`api/checklists/route.ts:206-224`). Start Daily Checklist
  (`store-view-client.tsx:71-90`) is a second caller that does create +
  `router.push(/store-view/checklist/${id})` — the exact behaviour this page
  needs.
- Reuse without changing Home: `start()` is a closure over `dispatch`,
  `setBusy`, `setError`, `onChanged` and `store`, so it cannot be called from
  another page as is. Reuse means extracting the POST and its error copy into
  a small client helper that returns `{ ok: true, id } | { ok: false,
  error }`, with Home's `start()` calling it and doing exactly what it does
  now. **That edits `tablet-home.tsx` — flagged as a no-behaviour-change
  refactor** (R6). Same for RN-6 naming: `typeOf` / `labelOf` are inline in
  `TasksPanel` (`tablet-home.tsx:1120-1122`); reuse means moving them to
  `src/lib/checklist-types.ts`. → **RULING NOW 2.**

### f. Upcoming

- **Yes, tablet Home lets an upcoming checklist be started today.** `start()`
  has no lifecycle check (`:1000-1033`); the hero's button is disabled only
  while busy (`tablet-checklist-switcher.tsx:202`); its action is "Start" for
  any not-started, not-completed entry (`tablet-home.tsx:1203`); and POST
  `/api/checklists` has no window check (`route.ts:100-224`). `tablet-today.ts`
  rule 3 says so on purpose ("a crew in before the window opens can still
  start it"). So Start stays enabled on an upcoming tile.
- **But the "Opens <time>" chip has no data.** The route returns only
  `expectedEndAt` (`templates/route.ts:143`); it selects `expectedStartAt`
  internally (`:70`) for the window but does not return it. → **RULING NOW 1.**

### g. Change plan (file by file, pending "go")

1. `src/app/(app)/checklists/page.tsx` — at the top of `ChecklistsPage`, if
   `getViewMode() === "tablet"`: load the Home-scoped store list (active,
   name asc, `getUserStoreScope`, as `dashboard/page.tsx:34-38`),
   `loadTabletData(org.id, stores)` (re-used, for tick-level counts and the
   store-zone header date), and the banner's PIN props (the page's existing
   `pinGateApplies` / `loadPinStaffByStore`); return `<ChecklistsTablet …/>`.
   The desktop path below is untouched and its queries do not run in tablet
   mode.
2. **NEW** `src/app/(app)/checklists/checklists-tablet.tsx` — client.
   Store via `useSavedStoreId` + `resolveSingleStore`; list via GET
   `/api/stores/[id]/templates`; order via `orderTodayChecklists` (RN-3) with
   an in-progress test of row status ≠ Pending or any ticked task in the
   loaded row; tiles for ranks 0–2, "Done today" rows for completed; header
   "Today's checklists" · date · "X of Y done"; type colours/icons from
   `checklistTypeStyle`; Continue / View as `<a>` to
   `/store-view/checklist/[id]`; Start via the shared helper then
   `router.push`; skeleton while loading; `CalendarDueBanner
   storeId={store.id}`. Landscape two columns, portrait one column with the
   band sideways (`landscape:` / `portrait:` variants, as tablet Home).
3. `src/components/calendar-due-banner.tsx` — optional `storeId` prop,
   appended as `?storeId=` on its feed calls. Absent (both existing mounts)
   = byte-identical behaviour.
4. `src/lib/checklist-types.ts` — add the RN-6 label helper and the
   template-name-line rule (RULING NOW 3), moved out of `TasksPanel`.
5. **NEW** `src/lib/start-today-checklist.ts` — the POST + error copy.
6. `src/app/(app)/dashboard/tablet-home.tsx` — `start()` and `labelOf` call
   items 4–5. No behaviour change (RULING NOW 2).
7. If RULING NOW 1 (a): `src/app/api/stores/[id]/templates/route.ts` — add
   `expectedStartAt` to each row (one additive read field).
8. `src/lib/tablet-today.ts` — a pure `splitForChecklistsPage(ordered)` →
   `{ tiles, doneToday }` so the grouping is pinnable.
9. **NEW** `scripts/verify-tab14-checklists.ts` — store resolution and the
   banner's `?storeId=`, order + Done-today split, RN-6 naming + template
   line. Re-run `verify-tab13-switcher`, `verify-tab1-today`, `verify-tab8`,
   `verify-tab10`.

No schema, migration, permission, env var or write route. Stays TIER 2
unless RULING NOW 1 (a) is judged an API change worth escalating.

## RULING NOW

1. **"Opens <time>" needs the window start, which the route does not
   return.** (a) add `expectedStartAt` to GET `/api/stores/[id]/templates`
   (additive, read-only, Home ignores it) — *recommended*; (b) an "Opens
   later" chip with no time; (c) show the Due chip on upcoming tiles too.
2. **Reuse = touching `tablet-home.tsx`.** (a) extract the create-run POST
   and the RN-6 label into shared helpers, Home calling them unchanged
   (no-behaviour-change refactor, TAB-13 scripts re-run) — *recommended*;
   (b) leave Home alone and have this page make its own POST (a third copy,
   alongside Home and Start Daily Checklist).
3. **When does the template-name second line show?** Keva's templates are
   "Opener Checklist", "Mid-Shift Checklist", "Closer Checklist" — all
   literally differ from their type names, so a strict "differs" puts a
   second line on every tile (the mock shows none). (a) show it when the
   template name, letters only, does not CONTAIN the type name ("Overdue
   Test" / Cleaning → line; "Closer Checklist" / Closer → none) —
   *recommended*; (b) strictly when the names differ; (c) when it differs
   after stripping a trailing "Checklist". Never when RN-6 already made the
   title the template name.
4. **Today rows Home's list drops** (template archived/deactivated mid-day,
   or store unassigned mid-day): (a) follow Home — not shown on tablet —
   *recommended* (R3 as written); (b) append them as extra tiles.
5. **Which empty state?** R7 says "the existing empty state, unchanged". The
   page's is "No checklists found / Generate checklists for your stores using
   the button in the top right corner" (`page.tsx:156-160`) — admin copy for
   a button that does not exist on the tablet. (a) Home's "No checklists
   today / Nothing is scheduled for <store> today…" (`tablet-home.tsx:1133-
   1138`) — *recommended*; (b) the page's own, unchanged.
6. **Refresh.** Home re-reads on a TAB-5/TAB-8 cycle. (a) this page reads on
   every visit only (server render + one fetch on mount) — *recommended*;
   (b) reuse Home's refresh controller.

## Prompt premises found wrong

- "TAB-12 … the 'N overdue' pill": TAB-12 is message types; the pill is
  TAB-1 / TAB-1c / TAB-9.
- "`tablet-home.tsx:957`": `start()` is at `:1000`; `:957` is in `toggle()`.
- "36 days overdue": 47 today on staging; same figure, later day.
