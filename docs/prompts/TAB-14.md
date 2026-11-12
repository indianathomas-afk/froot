TIER 2 — contained (escalate to TIER 3 and STOP if the audit finds a schema, API-permission, or write-route change is needed)

# TAB-14 — Tablet Checklists page: type-first, this store only

> Ticket id is provisional. Confirm TAB-14 is the next free TAB id in `docs/ROADMAP.yaml` (TAB-13 shipped 2026-11-11 at `def04fa`). If it's taken, use the next free id and rename this file to match.

## Why

In tablet mode, `/checklists` is the desktop admin list squeezed onto a tablet:

- **Every store is shown.** The page lists all stores ("All My Stores"), and each card's title is the store name. On the Carson tablet, "Carson" is the least useful word on the card.
- **The type is hard to spot.** The checklist type (Opener, Mid-Shift, Cleaning, Closer) is a small grey tag, so staff can't find their checklist at a glance.
- **The red overdue banner lists other stores** (Meadowood Mall 3, Sparks 2). On a Carson tablet that's noise and false alarm.

TAB-13 fixed the same problem on Home. This phase brings the Checklists page in line by reusing what TAB-13 built:

- `src/lib/checklist-types.ts`: the type color and icon key, built "ready for the Checklists page phase".
- The RN-3 order in `src/lib/tablet-today.ts`.

## Design source

The design PDF "Froot Tablet — Checklists". Use only these boards:

- "Checklists · Tablet landscape"
- "Checklists · Tablet portrait (with store-only overdue alert)"
- "Checklist type key"

Ignore both Home boards; they shipped in TAB-13.

Where the mock and TAB-13's ratified rulings disagree, **TAB-13 wins**:

- **Naming** follows RN-6: show the template name when there are two of a type today, or when a template has no type name.
- **Text on a colored fill** is ≥19px bold (R8).
- **Colors and icons** come from `checklist-types.ts`. Never redefine them on this page.
- **Keva's closing type is "Closer".** It's already aliased to Closing.

The mock is drawn at 1194×834 (iPad landscape) and 834×1194 (portrait). If tablet mode's existing scale differs, match the hierarchy and proportions, not the raw px values.

## Standing rules (unchanged; CLAUDE.md wins on any conflict)

- **Repo:** the root is `~/Claude_Projects/Froot/froot` (lowercase). Work on staging. One phase per session, no riders.
- **Verify everything:** treat every claim in this prompt and the ROADMAP as unverified until re-checked at file:line, including the TAB-13 line numbers quoted below.
- **Gates:** audit first. At each STOP, wait for Gdogg's "go".
- **Causes:** before any causal explanation, state the evidence that would disprove it.
- **DB evidence:** must show the Neon branch column in the same output.
  - Branches: dev `br-broad-wave`, staging `br-square-feather`, production `br-sparkling-block`.
  - Never query the preview/main fossil. No `vercel env pull`.
- **Browser evidence:** name the org id (`org_3G02wO4QlVVSWppi8aqlnSZnsDa`) and Clerk instance (`verified-snapper-7`) before testing.
- **Commits:**
  - `npm run build && git commit` chained; lint doesn't gate.
  - Two-commit pattern: work, then docs citing the work SHA.
  - Commit only when asked. Never push; Gdogg runs all pushes.
- **Tablet mode only.** Desktop `/checklists` must look and behave exactly as it does now.
- **Reports:** every STOP report opens with a 3–5 line plain-English summary.

## Proposed rulings (ratify, amend, or strike at Gate 1)

**R1 — Scope.** Tablet-mode `/checklists` only. Out of scope:

- desktop `/checklists`
- Home, tablet and desktop (TAB-13 must keep working untouched)
- the execution page `/store-view/checklist/[id]`
- template admin
- schema and any API write route

DEBT-130, 131 and 132 stay open. Don't fix them here.

**R2 — One store.** In tablet mode the page shows only the tablet's current store, the same store tablet Home uses. The audit says where that comes from.

- No "All My Stores" picker in tablet mode.
- No store name on the cards.
- Store switching stays on Home, as it works today.

**R3 — Which checklists.** Use the same list tablet Home reads (`GET /api/stores/[id]/templates`, per TAB-13 RN-4), so a checklist nobody has started still appears. If today's page shows anything Home's list doesn't (for example, a row from an earlier day), report it at Gate 1 as a RULING NOW.

**R4 — Order and grouping.**

- Reuse TAB-13's order (RN-3): in progress → not started and due now → not started with the window not open → completed.
- The first three groups are big tiles.
- Completed checklists collapse into a "Done today" row at the bottom: icon chip, type name, a "Completed" chip, and View.

**R5 — Tile**, per the landscape board:

- **Band** (type fill and ink): the icon chip, a big type name (RN-6 naming), "N tasks", and the Due chip when there's a due time.
- **Template name:** when it differs from the type name (e.g. type Cleaning, template "Overdue Test"), show it as a second line in the band, ≥19px bold.
- **Upcoming** (window not open): an "Opens <time>" chip replaces the Due chip.
- **Card body:** status ("In progress" / "Not started"), "X of Y done", and a progress bar in the type color.
- **Button:** one full-width button reading Start or Continue.
- **Counts:** the tick list's own total once a run exists, the route's `taskCount` before that. Same as TAB-13 (DEBT-132).

**R6 — Button targets.**

- Start, Continue and View go where the page's "View Checklist" goes today (expected `/store-view/checklist/[id]`; verify).
- Start on a checklist with no run yet creates the run exactly as tablet Home does (TAB-13 audit: `tablet-home.tsx:957`), then opens it.
  - Reuse that logic; don't copy it.
  - If reuse means moving it into a shared helper, that's allowed only as a no-behavior-change refactor. Flag it in the plan.
- An upcoming checklist can be started on this page only if tablet Home allows it today.
- No new route. View still opens an editable page (DEBT-131).

**R7 — Layout.**

- **Landscape:** two columns of tiles.
- **Portrait:** one column, with the band laid out sideways (the portrait board).
- **More tiles:** the page scrolls vertically. Nothing shrinks below the board's sizes; type names stay ≥48px in landscape.
- **Header:** "Today's checklists", the date, and "X of Y done".
- **No checklists today:** the existing empty state, unchanged.

**R8 — Overdue banner.**

- In tablet mode, show only this store's overdue items, using the existing banner's data and actions: its chips and links do what they do today.
- Hide the banner when the store has none.
- If TAB-12 already built a store-scoped overdue control for tablet Home (the "N overdue" pill), compare the two and recommend one. If they count different things, that's a RULING NOW.
- The mock's "Yesterday's Cleaning wasn't finished · Finish it" is illustrative only. Missed checklists are locked (`checklist-execution-client.tsx:264`), so add no new "Finish it" action.

**R9 — Accessibility and code.**

- Use real `<button>` and `<a>` elements, with touch targets ≥44px.
- Any text on a colored fill is ≥19px bold.
- Use lucide-react and the existing tokens. No new dependencies.
- Write full Tailwind class names out, never assembled from variables (`badge-presets.ts:1-11`).

## Gate 0 — Preflight (read-only)

- **Repo state:** confirm the repo root, staging at `adc0f9e` matching origin (main at `def04fa`), a clean tree except this prompt, and the next free TAB id.
- **Read** TAB-13's DECISIONS entry, DEBT-130–132, `src/lib/checklist-types.ts`, and `src/lib/tablet-today.ts`.
- **"Before" screenshots, taken now, before anything is pushed** (lesson from TAB-13 check 7). Name the org id and Clerk instance first.
  - Desktop `/checklists` on staging.
  - Tablet-mode `/checklists` on staging at Las Brisas.

## Gate 1 — Audit (read-only) → STOP

Report with file:line:

a. **Rendering:** how `/checklists` renders today, where tablet mode branches for it (if at all), and whether desktop shares the component.
b. **Data:** the page's data source vs. Home's templates route, and anything one shows that the other doesn't. State disconfirming evidence first.
c. **Store:** how tablet mode knows its current store (a TAB-1 or TAB-4 pin?), and how this page will read it.
d. **Overdue banner:** what it counts (checklists? tasks? from which days? It currently reads "36 days overdue"), how it scopes stores, and how it compares with TAB-12's Home control, if one exists.
e. **Buttons:** where the buttons go today, and whether Home's create-run logic can be reused without changing Home's behavior.
f. **Upcoming:** can an upcoming checklist be started on tablet Home today?
g. **Plan:** a file-by-file change plan, plus any RULING NOW items.

**STOP.** Wait for "go" and for R1–R9 to be ratified.

## Gate 2 — Build

- Implement the approved plan only. Match the PDF's Checklists boards for hierarchy, colors, spacing, radii and type weights.
- Add `scripts/verify-tab14-checklists.ts`, pinning:
  - the store filter
  - the order and Done-today grouping (reusing RN-3)
  - the banner's store filter
  - RN-6 naming and the template-name line
- Re-run `verify-tab13-switcher`, `verify-tab1-today`, `verify-tab8` and `verify-tab10`.

## Gate 3 — Local verify → STOP

- `npm run build` passes, along with all verify scripts and scoped lint.
- Check the page locally in a tablet-sized viewport, landscape and portrait, if the dev server allows it.
- Report the results. **STOP.**

## Gate 4 — Commit (only when Gdogg says "commit")

- **Commit 1:** the work (`npm run build && git commit`).
- **Commit 2:** the docs, citing commit 1's SHA:
  - the ROADMAP row, with status per WORKFLOW (in_progress until PRE-PUSH-CHECK)
  - the DECISIONS draft
  - the audit file
  - one new DEBT row (log only, don't fix): the Done screen's "Up next" button says "Start" on a checklist that's already in progress. Label only; it predates TAB-13.
- The prompt of record waits for PRE-PUSH-CHECK, per convention. Do not push.

## Gate 5 — Staging evidence (after Gdogg's push)

First confirm the staging deploy matches HEAD. Then the session checks these in Chrome (org id and Clerk instance first):

1. **One store:** tablet `/checklists` at Las Brisas shows only Las Brisas, with no picker and no store names on the cards.
2. **Order:** the order follows RN-3, and completed checklists sit in "Done today".
3. **Buttons:**
   - Start on an unstarted checklist creates the run and opens it.
   - Continue opens the existing run.
   - View opens the completed one.
4. **Banner:** the overdue banner shows only Las Brisas items, or is hidden.
5. **Template name:** the "Overdue Test" Cleaning tile shows its template name as a second line.
6. **Desktop:** desktop `/checklists` is unchanged vs. the Gate 0 "before" shot.
7. **Home:** tablet Home still works; the TAB-13 tabs swap the hero.

Gdogg checks on the iPad:

- portrait layout
- a second store, if one is available

The session records these as observed by Gdogg.
